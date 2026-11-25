#property strict
#property version "6.00"

// Nhận lệnh từ bot Telegram (repo fx, src/bridge/tcp.js) qua TCP.
// Mỗi dòng là một JSON phẳng:
//   {"id":"m3k9x-1","type":"BUY","entry":4147.47,"sl":4140.15,"tp":4161.11,"risk":12.5}
//   {"type":"SL","price":4146.15}  {"type":"TP","price":4164.75}  {"type":"BE"}  {"type":"CANCEL"}
//   {"type":"CLOSE","side":"ALL"|"BUY"|"SELL"}

#include <Trade/Trade.mqh>

CTrade trade;

//================ INPUTS =================//

// Chỉ IP hoặc domain, KHÔNG có "http://". Nhớ thêm vào Tools > Options > Expert Advisors > Allow WebRequest/Socket.
input string SOCKET_HOST          = "127.0.0.1";
input int    SOCKET_PORT          = 3002;
input string SOCKET_TOKEN         = "CHANGE_ME";
input int    SOCKET_TIMER_MS      = 100;
input int    RECONNECT_SECONDS    = 3;
input long   MAGIC                = 2501153001;
input string COMMENT_TXT          = "";
input bool   DEBUG_LOG            = false;

// Thời hạn pending LIMIT tính từ lúc nhận lệnh (phút). 0 = GTC.
input int    LIMIT_EXPIRY_MINUTES = 240;
input double BE_OFFSET_PRICE      = 0.1;

// Chốt chặn tại tài khoản: risk (USD) trong lệnh lớn hơn mức này => bỏ lệnh. 0 = không chặn.
input double MAX_RISK_MONEY       = 100;

// Hệ số quy USD sang tiền tệ tài khoản. 0 = tự nhận (USC / cent -> 100, còn lại 1).
input double RISK_CURRENCY_FACTOR = 0;

// Lệnh CANCEL: false = hủy MỌI lệnh Buy/Sell Limit trên vàng (kể cả đặt tay).
// true = chỉ hủy lệnh Limit do EA này đặt (đúng MAGIC).
input bool   CANCEL_ONLY_OWN_ORDERS = false;

// Lệnh CLOSE: false = đóng MỌI position trên vàng (kể cả vào tay). true = chỉ position đúng MAGIC.
input bool   CLOSE_ONLY_OWN_POSITIONS = false;

//================ SYMBOL CANDIDATES =================//

const string GOLD_CANDIDATES[] =
{
   "XAUUSD", "XAUUSDc", "XAUUSD.sc", "XAUUSD.c",
   "XAUUSDm", "XAUUSD.a", "XAUUSD.v", "GOLD"
};

//================ GLOBALS =================//

long     g_last_login           = -1;
int      g_socket               = INVALID_HANDLE;
string   g_socket_buffer        = "";
datetime g_last_connect_attempt = 0;
datetime g_last_heartbeat       = 0;
datetime g_last_symbol_attempt  = 0;
string   g_trade_symbol         = "";

bool     g_chart_recovering     = false;
bool     g_pending_chart        = false;
datetime g_last_chart_recovery  = 0;

//================ LOG / STRING =================//

void Log(const string msg)
{
   if(DEBUG_LOG)
      Print(TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS), " | ", msg);
}

// Log quan trọng (vào lệnh, từ chối lệnh) luôn in ra, không phụ thuộc DEBUG_LOG.
void Info(const string msg)
{
   Print(TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS), " | ", msg);
}

string Trim(string value)
{
   StringTrimLeft(value);
   StringTrimRight(value);
   return value;
}

string ToUpperCopy(string value)
{
   StringToUpper(value);
   return value;
}

//================ SYMBOL UTILS =================//

bool IsUsableSymbol(const string symbol)
{
   if(symbol == "")
      return false;

   if(!(bool)SymbolInfoInteger(symbol, SYMBOL_EXIST))
      return false;

   return (ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(symbol, SYMBOL_TRADE_MODE)
          != SYMBOL_TRADE_MODE_DISABLED;
}

bool TrySelect(const string symbol)
{
   if(!IsUsableSymbol(symbol))
      return false;

   ResetLastError();

   if(SymbolSelect(symbol, true))
      return true;

   Log(StringFormat("SYMBOL SELECT FAILED | symbol=%s | error=%d", symbol, GetLastError()));
   return false;
}

// Lệnh luôn là vàng. EA tự dò symbol vàng của broker hiện tại.
string ResolveGoldSymbol()
{
   for(int i = 0; i < ArraySize(GOLD_CANDIDATES); i++)
      if(TrySelect(GOLD_CANDIDATES[i]))
         return GOLD_CANDIDATES[i];

   // Dự phòng: quét Market Watch, lấy symbol bắt đầu bằng "XAU".
   int total = SymbolsTotal(true);

   for(int i = 0; i < total; i++)
   {
      string symbol = SymbolName(i, true);

      if(StringFind(ToUpperCopy(symbol), "XAU") != 0)
         continue;

      if(TrySelect(symbol))
         return symbol;
   }

   Log(StringFormat("GOLD SYMBOL NOT FOUND | company=%s | server=%s",
                    AccountInfoString(ACCOUNT_COMPANY),
                    AccountInfoString(ACCOUNT_SERVER)));

   return "";
}

//================ CHART SYMBOL =================//

string PickChartSymbol()
{
   if(IsUsableSymbol(g_trade_symbol))
      return g_trade_symbol;

   g_trade_symbol = ResolveGoldSymbol();

   if(g_trade_symbol != "")
      return g_trade_symbol;

   for(int pass = 0; pass < 2; pass++)
   {
      bool selectedOnly = (pass == 0);   // 0 = Market Watch, 1 = toàn bộ broker
      int  total        = SymbolsTotal(selectedOnly);

      for(int i = 0; i < total; i++)
      {
         string symbol = SymbolName(i, selectedOnly);

         if(TrySelect(symbol))
            return symbol;
      }
   }

   return "";
}

void SyncChartSymbol()
{
   // Ngăn gọi lồng nhau khi ChartSetSymbolPeriod phát sinh CHARTEVENT_CHART_CHANGE.
   if(g_chart_recovering)
      return;

   string chartSymbol = Symbol();

   bool needGoldChart = g_pending_chart &&
                        !(IsUsableSymbol(g_trade_symbol) && chartSymbol == g_trade_symbol);

   if(IsUsableSymbol(chartSymbol) && !needGoldChart)
      return;

   datetime now = TimeLocal();

   if(now - g_last_chart_recovery < 2)
      return;

   g_last_chart_recovery = now;
   g_chart_recovering    = true;

   string safeSymbol = PickChartSymbol();

   if(safeSymbol == "")
   {
      Log("NO SAFE CHART SYMBOL FOUND");
      g_chart_recovering = false;
      return;
   }

   ResetLastError();

   bool requested = ChartSetSymbolPeriod(0, safeSymbol, (ENUM_TIMEFRAMES)Period());
   int  errorCode = GetLastError();

   Log(StringFormat("CHART SYMBOL RECOVERY | old=%s | new=%s | requested=%d | error=%d",
                    chartSymbol, safeSymbol, (int)requested, errorCode));

   if(requested)
      ChartRedraw(0);

   g_chart_recovering = false;
}

//================ NORMALIZE =================//

double NormalizePrice(const string symbol, const double price)
{
   return NormalizeDouble(price, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS));
}

// Làm tròn XUỐNG theo volume step. Nhỏ hơn lot tối thiểu => trả 0 (bỏ lệnh) để không vượt rủi ro.
double FloorVolume(const string symbol, const double volume)
{
   double volumeMin  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double volumeMax  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double volumeStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);

   if(volumeStep <= 0.0)
      volumeStep = 0.01;

   // +1e-9 để 0.14 / 0.01 = 13.99999999 không bị floor thành 13
   double lot = MathFloor(volume / volumeStep + 1e-9) * volumeStep;

   if(lot < volumeMin - 1e-12)
      return 0.0;

   lot = MathMin(lot, volumeMax);

   int stepDigits = (int)MathMax(0.0, MathCeil(-MathLog10(volumeStep) - 1e-9));

   return NormalizeDouble(lot, stepDigits);
}

//================ RISK -> LOT =================//

double RiskCurrencyFactor()
{
   if(RISK_CURRENCY_FACTOR > 0.0)
      return RISK_CURRENCY_FACTOR;

   string currency = ToUpperCopy(AccountInfoString(ACCOUNT_CURRENCY));

   if(currency == "USC" || currency == "USX" || StringFind(currency, "CENT") >= 0)
      return 100.0;

   return 1.0;
}

// lossPerLot: số tiền (tiền tệ tài khoản) mất khi 1 lot đi từ entry tới SL.
// OrderCalcProfit đã tính sẵn contract size, tick value, tỷ giá của broker này.
double CalcLotForRisk(const string symbol,
                      const bool isBuy,
                      const double entry,
                      const double stopLoss,
                      const double riskAccountMoney,
                      double &lossPerLot)
{
   lossPerLot = 0.0;

   if(stopLoss <= 0.0 || riskAccountMoney <= 0.0)
      return 0.0;

   double pnl = 0.0;

   ResetLastError();

   if(!OrderCalcProfit(isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL,
                       symbol, 1.0, entry, stopLoss, pnl))
   {
      Info(StringFormat("ORDER CALC PROFIT FAILED | symbol=%s | error=%d", symbol, GetLastError()));
      return 0.0;
   }

   // pnl >= 0 nghĩa là SL nằm sai phía entry
   if(pnl >= 0.0)
      return 0.0;

   lossPerLot = -pnl;

   return FloorVolume(symbol, riskAccountMoney / lossPerLot);
}

//================ TCP SOCKET =================//

void CloseSignalSocket(const string reason = "")
{
   if(g_socket != INVALID_HANDLE)
   {
      SocketClose(g_socket);
      g_socket = INVALID_HANDLE;
   }

   g_socket_buffer = "";

   if(reason != "")
      Log("SOCKET CLOSED | " + reason);
}

bool SendSocketLine(const string line)
{
   if(g_socket == INVALID_HANDLE || !SocketIsConnected(g_socket))
      return false;

   uchar data[];
   int length = StringToCharArray(line + "\n", data, 0, WHOLE_ARRAY, CP_UTF8) - 1;

   if(length <= 0)
      return false;

   ResetLastError();
   int sent = SocketSend(g_socket, data, (uint)length);

   if(sent != length)
   {
      Log(StringFormat("SOCKET SEND FAILED | sent=%d/%d | error=%d",
                       sent, length, GetLastError()));
      CloseSignalSocket("send failed");
      return false;
   }

   return true;
}

bool ConnectSignalSocket()
{
   if(g_socket != INVALID_HANDLE && SocketIsConnected(g_socket))
      return true;

   datetime now = TimeLocal();

   if(now - g_last_connect_attempt < RECONNECT_SECONDS)
      return false;

   g_last_connect_attempt = now;
   CloseSignalSocket();

   ResetLastError();
   g_socket = SocketCreate(SOCKET_DEFAULT);

   if(g_socket == INVALID_HANDLE)
   {
      Log(StringFormat("SOCKET CREATE FAILED | error=%d", GetLastError()));
      return false;
   }

   SocketTimeouts(g_socket, 1000, 1000);
   ResetLastError();

   if(!SocketConnect(g_socket, SOCKET_HOST, (uint)SOCKET_PORT, 2000))
   {
      Log(StringFormat("SOCKET CONNECT FAILED | %s:%d | error=%d",
                       SOCKET_HOST, SOCKET_PORT, GetLastError()));
      CloseSignalSocket();
      return false;
   }

   string hello = StringFormat(
      "{\"type\":\"HELLO\",\"token\":\"%s\",\"login\":%I64d,\"server\":\"%s\"}",
      SOCKET_TOKEN,
      (long)AccountInfoInteger(ACCOUNT_LOGIN),
      AccountInfoString(ACCOUNT_SERVER));

   if(!SendSocketLine(hello))
      return false;

   g_last_heartbeat = TimeLocal();

   Log(StringFormat("SOCKET CONNECTED | %s:%d | login=%I64d",
                    SOCKET_HOST, SOCKET_PORT,
                    (long)AccountInfoInteger(ACCOUNT_LOGIN)));

   return true;
}

void ProcessSignalJson(string json);

void ReadSignalSocket()
{
   if(!ConnectSignalSocket())
      return;

   if(!SocketIsConnected(g_socket))
   {
      CloseSignalSocket("disconnected");
      return;
   }

   uint available = SocketIsReadable(g_socket);

   while(available > 0)
   {
      uchar bytes[];
      int readCount = SocketRead(g_socket, bytes, available, 10);

      if(readCount <= 0)
      {
         CloseSignalSocket("read failed");
         return;
      }

      g_socket_buffer += CharArrayToString(bytes, 0, readCount, CP_UTF8);

      if(StringLen(g_socket_buffer) > 1024 * 1024)
      {
         CloseSignalSocket("receive buffer overflow");
         return;
      }

      available = SocketIsReadable(g_socket);
   }

   while(true)
   {
      int newline = StringFind(g_socket_buffer, "\n");

      if(newline < 0)
         break;

      string line = Trim(StringSubstr(g_socket_buffer, 0, newline));
      g_socket_buffer = StringSubstr(g_socket_buffer, newline + 1);

      if(line == "" || line == "PONG")
         continue;

      if(line == "AUTH_OK")
      {
         Info(StringFormat("SOCKET AUTH OK | login=%I64d | server=%s",
                           (long)AccountInfoInteger(ACCOUNT_LOGIN),
                           AccountInfoString(ACCOUNT_SERVER)));
         continue;
      }

      if(line == "PING")
      {
         SendSocketLine("PONG");
         continue;
      }

      if(line == "AUTH_FAILED")
      {
         Info("SOCKET AUTH FAILED: sai SOCKET_TOKEN");
         CloseSignalSocket("authentication failed");
         return;
      }

      ProcessSignalJson(line);
   }

   datetime now = TimeLocal();

   if(now - g_last_heartbeat >= 20 && SendSocketLine("PING"))
      g_last_heartbeat = now;
}

//================ SIMPLE JSON PARSER =================//
// Chỉ dùng cho JSON phẳng do server tự sinh. Không hỗ trợ object lồng / mảng.

string GetString(string json, string key)
{
   int keyPosition = StringFind(json, "\"" + key + "\"");
   if(keyPosition < 0)
      return "";

   int colonPosition = StringFind(json, ":", keyPosition);
   if(colonPosition < 0)
      return "";

   int quoteStart = StringFind(json, "\"", colonPosition + 1);
   if(quoteStart < 0)
      return "";

   quoteStart++;

   int quoteEnd = StringFind(json, "\"", quoteStart);
   if(quoteEnd < 0)
      return "";

   return StringSubstr(json, quoteStart, quoteEnd - quoteStart);
}

double GetDouble(string json, string key)
{
   int keyPosition = StringFind(json, "\"" + key + "\"");
   if(keyPosition < 0)
      return 0.0;

   int colonPosition = StringFind(json, ":", keyPosition);
   if(colonPosition < 0)
      return 0.0;

   int valueStart = colonPosition + 1;
   int valueEnd   = StringFind(json, ",", valueStart);

   if(valueEnd < 0)
      valueEnd = StringFind(json, "}", valueStart);

   if(valueEnd < 0)
      return 0.0;

   return StringToDouble(StringSubstr(json, valueStart, valueEnd - valueStart));
}

//================ LEVEL VALIDATION =================//

bool IsLevelValid(const string symbol,
                  const ENUM_POSITION_TYPE side,
                  const bool isStop,
                  const double level,
                  const double currentPrice,
                  const bool useFreeze)
{
   if(level <= 0.0)
      return false;

   int requiredLevel = (int)SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);

   if(useFreeze)
      requiredLevel = MathMax(requiredLevel,
                              (int)SymbolInfoInteger(symbol, SYMBOL_TRADE_FREEZE_LEVEL));

   double minimumDistance = requiredLevel * SymbolInfoDouble(symbol, SYMBOL_POINT);

   // BUY-SL và SELL-TP phải nằm dưới giá hiện tại; hai trường hợp còn lại nằm trên.
   bool mustBeBelow = ((side == POSITION_TYPE_BUY) == isStop);

   return mustBeBelow ? (level <= currentPrice - minimumDistance)
                      : (level >= currentPrice + minimumDistance);
}

//================ SL / TP / BE ALL =================//

// type: "SL" | "TP" | "BE". Áp cho mọi position đang mở trên vàng;
// position nào mà mức này nằm sai phía thì bỏ qua.
int ApplyLevel(const string type, const double requestedPrice)
{
   bool isBE = (type == "BE");
   bool isSL = (type == "SL");
   bool isTP = (type == "TP");

   if(!isBE && !isSL && !isTP)
      return 0;

   if(g_trade_symbol == "")
   {
      Info(type + " FAILED | chưa tìm được symbol vàng của broker");
      return 0;
   }

   if(!isBE && requestedPrice <= 0.0)
   {
      Info(StringFormat("%s FAILED | giá không hợp lệ=%.5f", type, requestedPrice));
      return 0;
   }

   string symbol    = g_trade_symbol;
   int    digits    = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double halfPoint = SymbolInfoDouble(symbol, SYMBOL_POINT) * 0.5;
   bool   touchesSL = (isBE || isSL);

   int modifiedCount  = 0;
   int totalPositions = PositionsTotal();

   for(int i = totalPositions - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);

      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;

      if(PositionGetString(POSITION_SYMBOL) != symbol)
         continue;

      ENUM_POSITION_TYPE side = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);

      double currentSL    = PositionGetDouble(POSITION_SL);
      double currentTP    = PositionGetDouble(POSITION_TP);
      double currentPrice = PositionGetDouble(POSITION_PRICE_CURRENT);

      if(currentPrice <= 0.0)
         continue;

      double target = requestedPrice;

      if(isBE)
      {
         double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);

         target = (side == POSITION_TYPE_BUY)
                  ? openPrice + BE_OFFSET_PRICE
                  : openPrice - BE_OFFSET_PRICE;
      }

      target = NormalizeDouble(target, digits);

      double existing = touchesSL ? currentSL : currentTP;

      if(existing > 0.0 && MathAbs(existing - target) < halfPoint)
         continue;

      // BE không được kéo SL về vị trí xấu hơn hiện tại.
      if(isBE)
      {
         if(side == POSITION_TYPE_BUY && currentSL > target)
            continue;

         if(side == POSITION_TYPE_SELL && currentSL > 0.0 && currentSL < target)
            continue;
      }

      if(!IsLevelValid(symbol, side, touchesSL, target, currentPrice, !isBE))
      {
         Log(StringFormat("%s SKIP | ticket=%I64u | %s | mức=%.*f | giá=%.*f",
                          type, ticket, side == POSITION_TYPE_BUY ? "BUY" : "SELL",
                          digits, target, digits, currentPrice));
         continue;
      }

      double newSL = touchesSL ? target : currentSL;
      double newTP = touchesSL ? currentTP : target;

      ResetLastError();

      bool ok = trade.PositionModify(ticket, newSL, newTP);
      uint retcode = trade.ResultRetcode();

      if(!ok || (retcode != TRADE_RETCODE_DONE && retcode != TRADE_RETCODE_NO_CHANGES))
      {
         Info(StringFormat("%s FAIL | ticket=%I64u | ret=%u | %s | error=%d",
                           type, ticket, retcode,
                           trade.ResultRetcodeDescription(), GetLastError()));
         continue;
      }

      modifiedCount++;
   }

   Info(StringFormat("%s ALL | price=%.*f | modified=%d", type, digits, requestedPrice, modifiedCount));

   return modifiedCount;
}

//================ CANCEL =================//

// Chỉ hủy Buy Limit / Sell Limit trên vàng. Lệnh Stop, Stop Limit giữ nguyên.
int CancelPendingOrders()
{
   string symbol = g_trade_symbol;

   if(symbol == "")
   {
      Info("CANCEL FAILED | chưa tìm được symbol vàng của broker");
      return 0;
   }

   int cancelled = 0;
   int failed    = 0;

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);

      if(ticket == 0 || !OrderSelect(ticket))
         continue;

      if(OrderGetString(ORDER_SYMBOL) != symbol)
         continue;

      if(CANCEL_ONLY_OWN_ORDERS && OrderGetInteger(ORDER_MAGIC) != MAGIC)
         continue;

      ENUM_ORDER_TYPE orderType = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);

      if(orderType != ORDER_TYPE_BUY_LIMIT && orderType != ORDER_TYPE_SELL_LIMIT)
         continue;

      ResetLastError();

      if(trade.OrderDelete(ticket) && trade.ResultRetcode() == TRADE_RETCODE_DONE)
         cancelled++;
      else
      {
         failed++;
         Info(StringFormat("CANCEL FAIL | ticket=%I64u | ret=%u | %s | error=%d",
                           ticket, trade.ResultRetcode(),
                           trade.ResultRetcodeDescription(), GetLastError()));
      }
   }

   Info(StringFormat("CANCEL | symbol=%s | ownOnly=%d | cancelled=%d | failed=%d",
                     symbol, (int)CANCEL_ONLY_OWN_ORDERS, cancelled, failed));

   return cancelled;
}

//================ CLOSE =================//

// side: "BUY" | "SELL" | còn lại = đóng cả hai chiều.
int ClosePositions(const string side)
{
   string symbol = g_trade_symbol;

   if(symbol == "")
   {
      Info("CLOSE FAILED | chưa tìm được symbol vàng của broker");
      return 0;
   }

   bool onlyBuy  = (side == "BUY");
   bool onlySell = (side == "SELL");

   int closed = 0;
   int failed = 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);

      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;

      if(PositionGetString(POSITION_SYMBOL) != symbol)
         continue;

      if(CLOSE_ONLY_OWN_POSITIONS && PositionGetInteger(POSITION_MAGIC) != MAGIC)
         continue;

      ENUM_POSITION_TYPE type = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);

      if((onlyBuy && type != POSITION_TYPE_BUY) || (onlySell && type != POSITION_TYPE_SELL))
         continue;

      ResetLastError();

      if(trade.PositionClose(ticket) && trade.ResultRetcode() == TRADE_RETCODE_DONE)
         closed++;
      else
      {
         failed++;
         Info(StringFormat("CLOSE FAIL | ticket=%I64u | ret=%u | %s | error=%d",
                           ticket, trade.ResultRetcode(),
                           trade.ResultRetcodeDescription(), GetLastError()));
      }
   }

   Info(StringFormat("CLOSE | side=%s | symbol=%s | ownOnly=%d | closed=%d | failed=%d",
                     (onlyBuy || onlySell) ? side : "ALL", symbol,
                     (int)CLOSE_ONLY_OWN_POSITIONS, closed, failed));

   return closed;
}

//================ PLACE ORDER =================//

bool PlaceLimit(const bool isBuy,
                const string symbol,
                const double lot,
                const double entry,
                const double stopLoss,
                const double takeProfit)
{
   ENUM_ORDER_TYPE_TIME timeType = (LIMIT_EXPIRY_MINUTES > 0) ? ORDER_TIME_SPECIFIED : ORDER_TIME_GTC;
   datetime expiry = (LIMIT_EXPIRY_MINUTES > 0)
                     ? (datetime)(TimeCurrent() + (long)LIMIT_EXPIRY_MINUTES * 60)
                     : (datetime)0;

   ResetLastError();

   bool ok = isBuy
      ? trade.BuyLimit(lot, entry, symbol, stopLoss, takeProfit, timeType, expiry, COMMENT_TXT)
      : trade.SellLimit(lot, entry, symbol, stopLoss, takeProfit, timeType, expiry, COMMENT_TXT);

   // Một số broker không nhận expiry => thử lại GTC
   if(!ok && timeType == ORDER_TIME_SPECIFIED)
   {
      Log(StringFormat("LIMIT SPECIFIED FAILED -> TRY GTC | ret=%u | %s",
                       trade.ResultRetcode(), trade.ResultRetcodeDescription()));

      ResetLastError();

      ok = isBuy
         ? trade.BuyLimit(lot, entry, symbol, stopLoss, takeProfit, ORDER_TIME_GTC, 0, COMMENT_TXT)
         : trade.SellLimit(lot, entry, symbol, stopLoss, takeProfit, ORDER_TIME_GTC, 0, COMMENT_TXT);
   }

   return ok;
}

// BUY/SELL: đặt LIMIT tại entry. Nếu giá đã đi qua entry theo hướng có lợi
// (BUY: Ask <= entry, SELL: Bid >= entry) thì vào MARKET, lot tính lại theo giá khớp.
void PlaceSignalOrder(const bool isBuy, const string json)
{
   string id    = GetString(json, "id");
   string side  = isBuy ? "BUY" : "SELL";
   double entry = GetDouble(json, "entry");
   double sl    = GetDouble(json, "sl");
   double tp    = GetDouble(json, "tp");
   double risk  = GetDouble(json, "risk");

   if(entry <= 0.0 || sl <= 0.0 || risk <= 0.0)
   {
      Info(StringFormat("REJECTED | id=%s | thiếu entry/sl/risk | %s", id, json));
      return;
   }

   if(MAX_RISK_MONEY > 0.0 && risk > MAX_RISK_MONEY)
   {
      Info(StringFormat("REJECTED | id=%s | risk=%.2f USD > MAX_RISK_MONEY=%.2f USD", id, risk, MAX_RISK_MONEY));
      return;
   }

   string symbol = g_trade_symbol;

   if(symbol == "" || !SymbolSelect(symbol, true))
   {
      Info(StringFormat("REJECTED | id=%s | chưa tìm được symbol vàng của broker", id));
      return;
   }

   trade.SetTypeFillingBySymbol(symbol);

   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);

   entry = NormalizePrice(symbol, entry);
   sl    = NormalizePrice(symbol, sl);
   tp    = (tp > 0.0) ? NormalizePrice(symbol, tp) : 0.0;

   MqlTick tick;

   if(!SymbolInfoTick(symbol, tick) || tick.ask <= 0.0 || tick.bid <= 0.0)
   {
      Info(StringFormat("REJECTED | id=%s | không lấy được giá hiện tại", id));
      return;
   }

   double minDistance = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL) * SymbolInfoDouble(symbol, SYMBOL_POINT);
   double marketPrice = isBuy ? tick.ask : tick.bid;

   // LIMIT chỉ hợp lệ khi entry nằm dưới Ask (BUY) / trên Bid (SELL) ít nhất stops level
   bool   useMarket = isBuy ? (entry > tick.ask - minDistance) : (entry < tick.bid + minDistance);
   double price     = useMarket ? marketPrice : entry;

   if(isBuy ? (sl >= price) : (sl <= price))
   {
      Info(StringFormat("REJECTED | id=%s | %s | giá %.*f đã chạm/vượt SL %.*f", id, side, digits, price, digits, sl));
      return;
   }

   string currency    = AccountInfoString(ACCOUNT_CURRENCY);
   double riskAccount = risk * RiskCurrencyFactor();
   double lossPerLot  = 0.0;
   double lot         = CalcLotForRisk(symbol, isBuy, price, sl, riskAccount, lossPerLot);

   if(lot <= 0.0)
   {
      double minLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);

      Info(StringFormat("REJECTED | id=%s | lot < min | risk=%.2f %s | minLot=%.3f cần risk=%.2f %s",
                        id, riskAccount, currency, minLot, minLot * lossPerLot, currency));
      return;
   }

   ResetLastError();

   bool ok = useMarket
      ? (isBuy ? trade.Buy(lot, symbol, 0.0, sl, tp, COMMENT_TXT)
               : trade.Sell(lot, symbol, 0.0, sl, tp, COMMENT_TXT))
      : PlaceLimit(isBuy, symbol, lot, entry, sl, tp);

   uint retcode = trade.ResultRetcode();

   if(!ok || (retcode != TRADE_RETCODE_DONE && retcode != TRADE_RETCODE_PLACED))
   {
      Info(StringFormat("TRADE FAIL | id=%s | %s %s | lot=%.3f | ret=%u | %s | error=%d",
                        id, side, useMarket ? "MARKET" : "LIMIT", lot, retcode,
                        trade.ResultRetcodeDescription(), GetLastError()));
      return;
   }

   Info(StringFormat("TRADE OK | id=%s | %s %s | ticket=%I64u | %s | lot=%.3f | entry=%.*f | sl=%.*f | tp=%.*f | risk=%.2f/%.2f %s",
                     id, side, useMarket ? "MARKET" : "LIMIT", trade.ResultOrder(), symbol, lot,
                     digits, price, digits, sl, digits, tp,
                     lot * lossPerLot, riskAccount, currency));
}

//================ SIGNAL DISPATCH =================//

void ProcessSignalJson(string json)
{
   json = Trim(json);

   if(StringLen(json) < 2 || StringFind(json, "{") < 0)
      return;

   string type = ToUpperCopy(Trim(GetString(json, "type")));

   if(type == "BUY" || type == "SELL")
      PlaceSignalOrder(type == "BUY", json);
   else if(type == "SL" || type == "TP")
      ApplyLevel(type, GetDouble(json, "price"));
   else if(type == "BE")
      ApplyLevel(type, 0.0);
   else if(type == "CANCEL")
      CancelPendingOrders();
   else if(type == "CLOSE")
      ClosePositions(ToUpperCopy(Trim(GetString(json, "side"))));
   else
      Info("UNSUPPORTED | " + json);
}

//================ INIT / DEINIT =================//

int OnInit()
{
   if(SOCKET_PORT <= 0 || SOCKET_PORT > 65535)
   {
      Print("SOCKET_PORT must be between 1 and 65535");
      return INIT_PARAMETERS_INCORRECT;
   }

   if(StringFind(SOCKET_HOST, "://") >= 0)
   {
      Print("SOCKET_HOST chỉ ghi IP hoặc domain, không có http://");
      return INIT_PARAMETERS_INCORRECT;
   }

   if(SOCKET_TIMER_MS < 20)
   {
      Print("SOCKET_TIMER_MS must be >= 20");
      return INIT_PARAMETERS_INCORRECT;
   }

   if(RECONNECT_SECONDS < 1)
   {
      Print("RECONNECT_SECONDS must be >= 1");
      return INIT_PARAMETERS_INCORRECT;
   }

   if(LIMIT_EXPIRY_MINUTES < 0)
   {
      Print("LIMIT_EXPIRY_MINUTES must be >= 0");
      return INIT_PARAMETERS_INCORRECT;
   }

   if(MAX_RISK_MONEY < 0.0 || RISK_CURRENCY_FACTOR < 0.0)
   {
      Print("MAX_RISK_MONEY và RISK_CURRENCY_FACTOR phải >= 0");
      return INIT_PARAMETERS_INCORRECT;
   }

   trade.SetExpertMagicNumber(MAGIC);

   g_last_login   = (long)AccountInfoInteger(ACCOUNT_LOGIN);
   g_trade_symbol = ResolveGoldSymbol();

   g_pending_chart = true;
   SyncChartSymbol();

   EventKillTimer();

   if(!EventSetMillisecondTimer(SOCKET_TIMER_MS))
   {
      Log(StringFormat("EVENT TIMER FAILED | error=%d", GetLastError()));
      return INIT_FAILED;
   }

   Info(StringFormat("INIT | login=%I64d | server=%s | tradeSymbol=%s | currency=%s | riskFactor=%.0f | maxRisk=%.2f USD",
                     g_last_login,
                     AccountInfoString(ACCOUNT_SERVER),
                     g_trade_symbol,
                     AccountInfoString(ACCOUNT_CURRENCY),
                     RiskCurrencyFactor(),
                     MAX_RISK_MONEY));

   ConnectSignalSocket();

   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   CloseSignalSocket("EA deinit");

   Log(StringFormat("DEINIT | reason=%d", reason));
}

//================ CHART EVENT =================//

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if(id != CHARTEVENT_CHART_CHANGE)
      return;

   if(IsUsableSymbol(Symbol()))
      return;

   g_pending_chart = true;
   SyncChartSymbol();
}

//================ TIMER =================//

void OnTimer()
{
   long login = (long)AccountInfoInteger(ACCOUNT_LOGIN);

   if(login != g_last_login)
   {
      g_last_login = login;
      trade.SetExpertMagicNumber(MAGIC);

      g_trade_symbol         = "";
      g_last_symbol_attempt  = 0;
      g_last_connect_attempt = 0;
      g_pending_chart        = true;

      CloseSignalSocket("account changed");

      Info(StringFormat("ACCOUNT CHANGED | login=%I64d | company=%s | server=%s | currency=%s",
                        g_last_login,
                        AccountInfoString(ACCOUNT_COMPANY),
                        AccountInfoString(ACCOUNT_SERVER),
                        AccountInfoString(ACCOUNT_CURRENCY)));

      return;
   }

   if(!IsUsableSymbol(g_trade_symbol))
   {
      datetime now = TimeLocal();

      if(now - g_last_symbol_attempt >= 2)
      {
         g_last_symbol_attempt = now;
         g_trade_symbol = ResolveGoldSymbol();

         if(g_trade_symbol != "")
            Log("TRADE SYMBOL RESOLVED | " + g_trade_symbol);
      }
   }

   SyncChartSymbol();

   if(g_pending_chart &&
      IsUsableSymbol(g_trade_symbol) &&
      Symbol() == g_trade_symbol)
   {
      g_pending_chart = false;

      Log(StringFormat("CHART RECOVERY COMPLETED | chartSymbol=%s | tradeSymbol=%s",
                       Symbol(), g_trade_symbol));
   }

   ReadSignalSocket();
}
