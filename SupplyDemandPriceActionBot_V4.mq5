//+------------------------------------------------------------------+
//| SupplyDemandPriceActionBot_V4.mq5                                |
//| Educational EA: Supply & Demand + Price Action + Trade Management|
//| V4: agrega ATR14 / RSI14 / ADX14 / MACD(12,26,9) visibles en el  |
//|     gráfico (subventanas + panel) y los usa como filtro de       |
//|     confluencia para reducir señales falsas y buscar una mayor   |
//|     proporción de operaciones ganadoras sobre perdedoras.        |
//+------------------------------------------------------------------+
#property copyright "Botsito Optimizada"
#property version   "4.00"
#property strict
#property description "V4: añade ATR14, RSI14, ADX14 y MACD(12,26,9) como paneles visibles en el gráfico y como filtro de confluencia de entradas (requiere N de 3 indicadores a favor + veto en extremos de RSI y mercados sin tendencia por ADX), manteniendo todas las correcciones de la V3 (cooldown, invalidación de zona, filtro de cuerpo por ATR)."

#include <Trade/Trade.mqh>

CTrade trade;

enum ENUM_TREND_FILTER
  {
   TREND_EMA = 0,
   TREND_STRUCTURE = 1,
   TREND_BOTH = 2
  };

input group "Strategy"
input ENUM_TIMEFRAMES InpSignalTimeframe = PERIOD_M5;
input ENUM_TREND_FILTER InpTrendFilter = TREND_BOTH;
input int InpLookbackBars = 220;
input int InpSwingDepth = 3;
input int InpAtrPeriod = 14;
input double InpImpulseAtrMultiplier = 1.8;
input double InpZoneAtrPadding = 0.15;
input int InpZoneMaxAgeBars = 140;
input int InpMinBarsBeforeRetest = 3;   // AHORA SÍ SE APLICA (bug corregido)
input bool InpDrawZones = true;
input bool InpInvalidateZoneAfterTrade = true; // no reentrar en la misma zona ya operada

input group "Price Action Confirmation"
input double InpMinWickToBodyRatio = 1.5;
input double InpMinBodyAtrRatio = 0.15;  // relativo al ATR
input bool InpAllowEngulfing = true;
input bool InpAllowPinBar = true;
input bool InpRequireCloseOutsideZone = true;

input group "Indicator Confirmation (ATR14 / RSI14 / ADX14 / MACD 12,26,9)"
input bool InpShowIndicatorsOnChart = true;  // dibuja ATR, RSI, ADX y MACD en subventanas del gráfico
input bool InpShowDashboard = true;          // panel de texto con lecturas y sesgo actual
input bool InpUseIndicatorFilters = true;    // usa los indicadores como filtro de confluencia antes de entrar
input int InpMinIndicatorConfirmations = 2;  // mínimo de indicadores a favor (de los activos) para operar
input int InpRSIPeriod = 14;
input double InpRSIOverbought = 70.0;
input double InpRSIOversold = 30.0;
input bool InpUseRSIFilter = true;
input int InpADXPeriod = 14;
input double InpADXMinStrength = 20.0;       // por debajo de esto se considera mercado sin tendencia (veto)
input bool InpUseADXFilter = true;
input int InpMACDFastEMA = 12;
input int InpMACDSlowEMA = 26;
input int InpMACDSignalPeriod = 9;
input bool InpUseMACDFilter = true;

input group "Risk Management"
input double InpRiskPercent = 1.0;
input double InpFixedLots = 0.0;
input double InpRewardRiskRatio = 2.0;
input int InpMaxSpreadPoints = 35;
input int InpStopBufferPoints = 30;
input int InpMagicNumber = 260724;
input int InpSlippagePoints = 20;
input bool InpOneTradePerSymbol = true;

input group "Trade Management"
input bool InpUseBreakeven = true;
input double InpBreakevenRR = 1.0;
input int InpBreakevenLockPoints = 20;

input group "Cooldown"
input bool InpUseCooldown = true;
input int InpCooldownBarsAfterLoss = 4; // barras de espera tras un SL antes de operar de nuevo

struct Zone
  {
   bool valid;
   bool tested;      // true si ya se operó/testeó esta zona
   bool supply;
   datetime created;
   int created_shift;
   double high;
   double low;
   string name;
  };

int atr_handle = INVALID_HANDLE;
int fast_ema_handle = INVALID_HANDLE;
int slow_ema_handle = INVALID_HANDLE;
int rsi_handle = INVALID_HANDLE;
int adx_handle = INVALID_HANDLE;
int macd_handle = INVALID_HANDLE;
datetime last_bar_time = 0;
Zone active_zone;
datetime cooldown_until = 0;

int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(InpSlippagePoints);
   atr_handle = iATR(_Symbol, InpSignalTimeframe, InpAtrPeriod);
   fast_ema_handle = iMA(_Symbol, InpSignalTimeframe, 50, 0, MODE_EMA, PRICE_CLOSE);
   slow_ema_handle = iMA(_Symbol, InpSignalTimeframe, 200, 0, MODE_EMA, PRICE_CLOSE);
   rsi_handle = iRSI(_Symbol, InpSignalTimeframe, InpRSIPeriod, PRICE_CLOSE);
   adx_handle = iADX(_Symbol, InpSignalTimeframe, InpADXPeriod);
   macd_handle = iMACD(_Symbol, InpSignalTimeframe, InpMACDFastEMA, InpMACDSlowEMA, InpMACDSignalPeriod, PRICE_CLOSE);

   if(atr_handle == INVALID_HANDLE || fast_ema_handle == INVALID_HANDLE || slow_ema_handle == INVALID_HANDLE ||
      rsi_handle == INVALID_HANDLE || adx_handle == INVALID_HANDLE || macd_handle == INVALID_HANDLE)
      return INIT_FAILED;

   active_zone.valid = false;
   active_zone.tested = false;

   if(InpShowIndicatorsOnChart)
      AttachVisualIndicators();

   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   if(atr_handle != INVALID_HANDLE) IndicatorRelease(atr_handle);
   if(fast_ema_handle != INVALID_HANDLE) IndicatorRelease(fast_ema_handle);
   if(slow_ema_handle != INVALID_HANDLE) IndicatorRelease(slow_ema_handle);
   if(rsi_handle != INVALID_HANDLE) IndicatorRelease(rsi_handle);
   if(adx_handle != INVALID_HANDLE) IndicatorRelease(adx_handle);
   if(macd_handle != INVALID_HANDLE) IndicatorRelease(macd_handle);
   Comment("");
  }

// Adjunta ATR14, RSI14, ADX14 y MACD(12,26,9) como subventanas visibles del gráfico
// (los "4 gráficos" solicitados), cada uno en su propia ventana debajo del precio.
void AttachVisualIndicators()
  {
   int win = (int)ChartGetInteger(0, CHART_WINDOWS_TOTAL);
   ChartIndicatorAdd(0, win, atr_handle);

   win = (int)ChartGetInteger(0, CHART_WINDOWS_TOTAL);
   ChartIndicatorAdd(0, win, rsi_handle);

   win = (int)ChartGetInteger(0, CHART_WINDOWS_TOTAL);
   ChartIndicatorAdd(0, win, adx_handle);

   win = (int)ChartGetInteger(0, CHART_WINDOWS_TOTAL);
   ChartIndicatorAdd(0, win, macd_handle);
  }

void OnTick()
  {
   ManageOpenTrades();

   datetime bar_time = iTime(_Symbol, InpSignalTimeframe, 0);
   if(bar_time == last_bar_time)
     {
      if(InpShowDashboard) UpdateDashboard();
      return;
     }
   last_bar_time = bar_time;

   if(Bars(_Symbol, InpSignalTimeframe) < InpLookbackBars + 20)
      return;

   UpdateZone();
   TryOpenTrade();

   if(InpShowDashboard) UpdateDashboard();
  }

void ManageOpenTrades()
  {
   if(!InpUseBreakeven) return;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(PositionSelectByTicket(ticket) && PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
        {
         double open_price = PositionGetDouble(POSITION_PRICE_OPEN);
         double current_sl = PositionGetDouble(POSITION_SL);
         double current_tp = PositionGetDouble(POSITION_TP);
         long type = PositionGetInteger(POSITION_TYPE);

         double risk = MathAbs(open_price - current_sl);
         if(risk == 0) continue;

         if(type == POSITION_TYPE_BUY)
           {
            if(current_sl < open_price)
              {
               double target_price = open_price + (risk * InpBreakevenRR);
               double current_price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
               if(current_price >= target_price)
                 {
                  double new_sl = open_price + (InpBreakevenLockPoints * _Point);
                  trade.PositionModify(ticket, new_sl, current_tp);
                 }
              }
           }
         else if(type == POSITION_TYPE_SELL)
           {
            if(current_sl > open_price)
              {
               double target_price = open_price - (risk * InpBreakevenRR);
               double current_price = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
               if(current_price <= target_price)
                 {
                  double new_sl = open_price - (InpBreakevenLockPoints * _Point);
                  trade.PositionModify(ticket, new_sl, current_tp);
                 }
              }
           }
        }
     }
  }

// Detecta si la última posición cerrada por magic/symbol fue una pérdida,
// y en tal caso arma un cooldown de N barras antes de permitir otra entrada.
void CheckLastClosedForCooldown()
  {
   if(!InpUseCooldown) return;

   if(!HistorySelect(0, TimeCurrent())) return;
   int deals = HistoryDealsTotal();
   for(int i = deals - 1; i >= 0; i--)
     {
      ulong deal_ticket = HistoryDealGetTicket(i);
      if(deal_ticket == 0) continue;
      if(HistoryDealGetString(deal_ticket, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(deal_ticket, DEAL_MAGIC) != InpMagicNumber) continue;
      if(HistoryDealGetInteger(deal_ticket, DEAL_ENTRY) != DEAL_ENTRY_OUT) continue;

      double profit = HistoryDealGetDouble(deal_ticket, DEAL_PROFIT) + HistoryDealGetDouble(deal_ticket, DEAL_SWAP) + HistoryDealGetDouble(deal_ticket, DEAL_COMMISSION);
      if(profit < 0)
        {
         cooldown_until = iTime(_Symbol, InpSignalTimeframe, 0) + PeriodSeconds(InpSignalTimeframe) * InpCooldownBarsAfterLoss;
        }
      break; // solo miramos el último cierre
     }
  }

void UpdateZone()
  {
   Zone newest;
   newest.valid = false;
   newest.tested = false;
   double atr[];
   ArraySetAsSeries(atr, true);
   if(CopyBuffer(atr_handle, 0, 0, InpLookbackBars + 5, atr) <= 0)
      return;

   for(int shift = InpMinBarsBeforeRetest + 2; shift < InpLookbackBars; shift++)
     {
      double open = iOpen(_Symbol, InpSignalTimeframe, shift);
      double close = iClose(_Symbol, InpSignalTimeframe, shift);
      double high = iHigh(_Symbol, InpSignalTimeframe, shift);
      double low = iLow(_Symbol, InpSignalTimeframe, shift);

      double range = high - low;
      double body = MathAbs(close - open);

      if(range < atr[shift] * InpImpulseAtrMultiplier) continue;
      if(body < range * 0.6) continue;

      bool bearish_impulse = close < open;
      bool bullish_impulse = close > open;
      if(!bearish_impulse && !bullish_impulse)
         continue;

      int base_shift = shift + 1;
      if(base_shift >= InpLookbackBars)
         continue;

      newest.valid = true;
      newest.tested = false;
      newest.supply = bearish_impulse;
      newest.created = iTime(_Symbol, InpSignalTimeframe, base_shift);
      newest.created_shift = base_shift;
      double pad = atr[shift] * InpZoneAtrPadding;
      newest.high = iHigh(_Symbol, InpSignalTimeframe, base_shift) + pad;
      newest.low = iLow(_Symbol, InpSignalTimeframe, base_shift) - pad;
      newest.name = StringFormat("SD_PA_%s_%I64d", newest.supply ? "SUPPLY" : "DEMAND", (long)newest.created);
      break;
     }

   if(!newest.valid) return;

   if(!active_zone.valid || active_zone.created != newest.created || active_zone.supply != newest.supply)
     {
      active_zone = newest;
      DrawZone(active_zone);
     }
  }

void TryOpenTrade()
  {
   if(!active_zone.valid) return;
   if(active_zone.tested && InpInvalidateZoneAfterTrade) return; // zona ya operada, no reentrar

   int zone_age = iBarShift(_Symbol, InpSignalTimeframe, active_zone.created);
   if(zone_age < 0 || zone_age > InpZoneMaxAgeBars) return;

   // Exigimos que hayan pasado al menos N barras desde la creación de la zona
   // antes de considerar válido un retest (evita entrar en el "rebote" inmediato del impulso).
   if(zone_age < InpMinBarsBeforeRetest) return;

   if(InpOneTradePerSymbol && HasOpenPosition()) return;
   if(SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) > InpMaxSpreadPoints) return;

   // Cooldown tras la última pérdida
   CheckLastClosedForCooldown();
   if(InpUseCooldown && TimeCurrent() < cooldown_until) return;

   int trend = GetTrendDirection();
   bool want_sell = active_zone.supply;
   if((want_sell && trend >= 0) || (!want_sell && trend <= 0)) return;

   double high = iHigh(_Symbol, InpSignalTimeframe, 1);
   double low = iLow(_Symbol, InpSignalTimeframe, 1);
   double close = iClose(_Symbol, InpSignalTimeframe, 1);

   bool touched = high >= active_zone.low && low <= active_zone.high;
   if(!touched) return;

   bool rejected = want_sell ? BearishConfirmation() : BullishConfirmation();
   if(!rejected)
     {
      // Si la zona fue tocada pero no confirmó, igual la marcamos como
      // "tocada una vez" para no seguir insistiendo en el mismo nivel vela tras vela.
      active_zone.tested = true;
      return;
     }

   if(InpRequireCloseOutsideZone)
     {
      if(want_sell && close > active_zone.low) { active_zone.tested = true; return; }
      if(!want_sell && close < active_zone.high) { active_zone.tested = true; return; }
     }

   // NUEVO V4: filtro de confluencia con ATR/RSI/ADX/MACD. La confirmación de price
   // action ya ocurrió en la vela cerrada; si los indicadores no acompañan, no forzamos
   // la entrada pero tampoco invalidamos la zona (las lecturas pueden cambiar en la
   // siguiente vela), simplemente esperamos.
   if(InpUseIndicatorFilters && !IndicatorConfirmation(want_sell))
      return;

   double entry = want_sell ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double buffer = InpStopBufferPoints * _Point;
   double sl = want_sell ? active_zone.high + buffer : active_zone.low - buffer;
   double risk_distance = MathAbs(entry - sl);
   if(risk_distance <= 0) return;

   double tp = want_sell ? entry - (risk_distance * InpRewardRiskRatio) : entry + (risk_distance * InpRewardRiskRatio);
   double lots = CalculateLots(risk_distance);
   if(lots <= 0) return;

   bool sent = false;
   if(want_sell)
      sent = trade.Sell(lots, _Symbol, entry, sl, tp, "Supply rejection sell");
   else
      sent = trade.Buy(lots, _Symbol, entry, sl, tp, "Demand rejection buy");

   if(sent)
      active_zone.tested = true; // zona consumida, no se vuelve a operar hasta que aparezca una nueva
  }

// NUEVO V4: exige confluencia de ATR/RSI/ADX/MACD antes de disparar la orden.
// - ADX es un veto duro: por debajo de InpADXMinStrength el mercado se considera sin
//   tendencia y las zonas de oferta/demanda son mucho menos fiables ahí.
// - RSI es un veto duro en extremos: no vender en sobreventa ni comprar en sobrecompra
//   (ahí el movimiento a favor de la zona suele estar agotado).
// - El resto (dirección de ADX +DI/-DI, lado de RSI respecto a 50, MACD vs señal) suman
//   como confirmaciones "blandas"; se exige un mínimo configurable (InpMinIndicatorConfirmations).
bool IndicatorConfirmation(const bool want_sell)
  {
   int needed = 0;
   int confirmations = 0;

   if(InpUseADXFilter)
     {
      double adx_main[], plus_di[], minus_di[];
      ArraySetAsSeries(adx_main, true);
      ArraySetAsSeries(plus_di, true);
      ArraySetAsSeries(minus_di, true);
      if(CopyBuffer(adx_handle, MAIN_LINE, 1, 1, adx_main) <= 0) return false;
      if(CopyBuffer(adx_handle, PLUSDI_LINE, 1, 1, plus_di) <= 0) return false;
      if(CopyBuffer(adx_handle, MINUSDI_LINE, 1, 1, minus_di) <= 0) return false;

      if(adx_main[0] < InpADXMinStrength) return false; // mercado sin tendencia -> veto duro

      needed++;
      bool dir_ok = want_sell ? (minus_di[0] > plus_di[0]) : (plus_di[0] > minus_di[0]);
      if(dir_ok) confirmations++;
     }

   if(InpUseRSIFilter)
     {
      double rsi[];
      ArraySetAsSeries(rsi, true);
      if(CopyBuffer(rsi_handle, 0, 1, 1, rsi) <= 0) return false;

      if(want_sell && rsi[0] <= InpRSIOversold) return false;    // no vender en sobreventa
      if(!want_sell && rsi[0] >= InpRSIOverbought) return false; // no comprar en sobrecompra

      needed++;
      bool mom_ok = want_sell ? (rsi[0] < 50.0) : (rsi[0] > 50.0);
      if(mom_ok) confirmations++;
     }

   if(InpUseMACDFilter)
     {
      double macd_main[], macd_signal[];
      ArraySetAsSeries(macd_main, true);
      ArraySetAsSeries(macd_signal, true);
      if(CopyBuffer(macd_handle, MAIN_LINE, 1, 1, macd_main) <= 0) return false;
      if(CopyBuffer(macd_handle, SIGNAL_LINE, 1, 1, macd_signal) <= 0) return false;

      needed++;
      bool macd_ok = want_sell ? (macd_main[0] < macd_signal[0]) : (macd_main[0] > macd_signal[0]);
      if(macd_ok) confirmations++;
     }

   if(needed == 0) return true; // todos los filtros de confluencia están desactivados

   int required = MathMax(1, MathMin(needed, InpMinIndicatorConfirmations));
   return confirmations >= required;
  }

int GetTrendDirection()
  {
   int ema_dir = 0;
   double fast[], slow[];
   ArraySetAsSeries(fast, true);
   ArraySetAsSeries(slow, true);
   if(CopyBuffer(fast_ema_handle, 0, 1, 2, fast) > 0 && CopyBuffer(slow_ema_handle, 0, 1, 2, slow) > 0)
      ema_dir = fast[0] > slow[0] ? 1 : (fast[0] < slow[0] ? -1 : 0);

   int structure_dir = GetStructureDirection();
   if(InpTrendFilter == TREND_EMA) return ema_dir;
   if(InpTrendFilter == TREND_STRUCTURE) return structure_dir;
   if(ema_dir == structure_dir) return ema_dir;
   return 0;
  }

int GetStructureDirection()
  {
   double last_high = 0, prev_high = 0, last_low = 0, prev_low = 0;
   for(int i = InpSwingDepth + 2; i < InpLookbackBars - InpSwingDepth; i++)
     {
      if(IsSwingHigh(i))
        {
         if(last_high == 0) last_high = iHigh(_Symbol, InpSignalTimeframe, i);
         else { prev_high = iHigh(_Symbol, InpSignalTimeframe, i); break; }
        }
     }
   for(int i = InpSwingDepth + 2; i < InpLookbackBars - InpSwingDepth; i++)
     {
      if(IsSwingLow(i))
        {
         if(last_low == 0) last_low = iLow(_Symbol, InpSignalTimeframe, i);
         else { prev_low = iLow(_Symbol, InpSignalTimeframe, i); break; }
        }
     }
   if(last_high < prev_high && last_low < prev_low) return -1;
   if(last_high > prev_high && last_low > prev_low) return 1;
   return 0;
  }

bool IsSwingHigh(const int shift)
  {
   double value = iHigh(_Symbol, InpSignalTimeframe, shift);
   for(int i = 1; i <= InpSwingDepth; i++)
      if(iHigh(_Symbol, InpSignalTimeframe, shift - i) >= value || iHigh(_Symbol, InpSignalTimeframe, shift + i) >= value)
         return false;
   return true;
  }

bool IsSwingLow(const int shift)
  {
   double value = iLow(_Symbol, InpSignalTimeframe, shift);
   for(int i = 1; i <= InpSwingDepth; i++)
      if(iLow(_Symbol, InpSignalTimeframe, shift - i) <= value || iLow(_Symbol, InpSignalTimeframe, shift + i) <= value)
         return false;
   return true;
  }

// Filtro de cuerpo mínimo relativo al ATR en vez de puntos fijos
// (15 puntos fijos en XAUUSD con 2 decimales equivale a $0.15, prácticamente inútil como filtro).
bool HasMinimumBody(const double body)
  {
   double atr[];
   ArraySetAsSeries(atr, true);
   if(CopyBuffer(atr_handle, 0, 1, 2, atr) <= 0) return true; // fallback: no bloquear si falla el ATR
   return body >= atr[0] * InpMinBodyAtrRatio;
  }

bool BearishConfirmation()
  {
   double open1 = iOpen(_Symbol, InpSignalTimeframe, 1), close1 = iClose(_Symbol, InpSignalTimeframe, 1);
   double high1 = iHigh(_Symbol, InpSignalTimeframe, 1), low1 = iLow(_Symbol, InpSignalTimeframe, 1);
   double body = MathAbs(close1 - open1);

   if(!HasMinimumBody(body)) return false;

   double upper_wick = high1 - MathMax(open1, close1);
   bool pin = InpAllowPinBar && close1 < open1 && upper_wick / body >= InpMinWickToBodyRatio;
   bool engulf = InpAllowEngulfing && close1 < open1 && close1 < iOpen(_Symbol, InpSignalTimeframe, 2) && open1 > iClose(_Symbol, InpSignalTimeframe, 2);

   return pin || engulf || (close1 < open1 && high1 >= active_zone.low && low1 < active_zone.low);
  }

bool BullishConfirmation()
  {
   double open1 = iOpen(_Symbol, InpSignalTimeframe, 1), close1 = iClose(_Symbol, InpSignalTimeframe, 1);
   double high1 = iHigh(_Symbol, InpSignalTimeframe, 1), low1 = iLow(_Symbol, InpSignalTimeframe, 1);
   double body = MathAbs(close1 - open1);

   if(!HasMinimumBody(body)) return false;

   double lower_wick = MathMin(open1, close1) - low1;
   bool pin = InpAllowPinBar && close1 > open1 && lower_wick / body >= InpMinWickToBodyRatio;
   bool engulf = InpAllowEngulfing && close1 > open1 && close1 > iOpen(_Symbol, InpSignalTimeframe, 2) && open1 < iClose(_Symbol, InpSignalTimeframe, 2);

   return pin || engulf || (close1 > open1 && low1 <= active_zone.high && high1 > active_zone.high);
  }

bool HasOpenPosition()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(PositionSelectByTicket(ticket) && PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
         return true;
     }
   return false;
  }

double CalculateLots(const double risk_distance)
  {
   if(InpFixedLots > 0) return NormalizeVolume(InpFixedLots);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double risk_money = balance * InpRiskPercent / 100.0;
   double tick_value = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tick_size = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tick_value <= 0 || tick_size <= 0) return 0;
   double loss_per_lot = (risk_distance / tick_size) * tick_value;
   if(loss_per_lot <= 0) return 0;
   return NormalizeVolume(risk_money / loss_per_lot);
  }

double NormalizeVolume(const double volume)
  {
   double min_lot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double max_lot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double lots = MathMax(min_lot, MathMin(max_lot, volume));
   return MathFloor(lots / step) * step;
  }

void DrawZone(const Zone &zone)
  {
   if(!InpDrawZones) return;
   ObjectDelete(0, zone.name);
   datetime right_time = iTime(_Symbol, InpSignalTimeframe, 0) + PeriodSeconds(InpSignalTimeframe) * 80;
   ObjectCreate(0, zone.name, OBJ_RECTANGLE, 0, zone.created, zone.high, right_time, zone.low);
   ObjectSetInteger(0, zone.name, OBJPROP_COLOR, zone.supply ? clrTomato : clrMediumSeaGreen);
   ObjectSetInteger(0, zone.name, OBJPROP_BACK, true);
   ObjectSetInteger(0, zone.name, OBJPROP_FILL, true);
  }

// NUEVO V4: panel de texto en el gráfico con la lectura actual de ATR/RSI/ADX/MACD,
// la tendencia detectada y el estado de la zona activa, para ver "de un vistazo"
// el análisis del bot sin tener que interpretar solo las subventanas.
void UpdateDashboard()
  {
   double atr[], rsi[], adx_main[], plus_di[], minus_di[], macd_main[], macd_signal[];
   ArraySetAsSeries(atr, true);
   ArraySetAsSeries(rsi, true);
   ArraySetAsSeries(adx_main, true);
   ArraySetAsSeries(plus_di, true);
   ArraySetAsSeries(minus_di, true);
   ArraySetAsSeries(macd_main, true);
   ArraySetAsSeries(macd_signal, true);

   bool ok = true;
   ok = ok && CopyBuffer(atr_handle, 0, 1, 1, atr) > 0;
   ok = ok && CopyBuffer(rsi_handle, 0, 1, 1, rsi) > 0;
   ok = ok && CopyBuffer(adx_handle, MAIN_LINE, 1, 1, adx_main) > 0;
   ok = ok && CopyBuffer(adx_handle, PLUSDI_LINE, 1, 1, plus_di) > 0;
   ok = ok && CopyBuffer(adx_handle, MINUSDI_LINE, 1, 1, minus_di) > 0;
   ok = ok && CopyBuffer(macd_handle, MAIN_LINE, 1, 1, macd_main) > 0;
   ok = ok && CopyBuffer(macd_handle, SIGNAL_LINE, 1, 1, macd_signal) > 0;
   if(!ok) return;

   int trend = GetTrendDirection();
   string trend_txt = trend > 0 ? "ALCISTA" : (trend < 0 ? "BAJISTA" : "SIN CONFIRMAR");

   string zone_txt = "sin zona activa";
   if(active_zone.valid)
      zone_txt = StringFormat("%s [%s]  %s - %s", active_zone.supply ? "OFERTA" : "DEMANDA",
                               active_zone.tested ? "operada" : "activa",
                               DoubleToString(active_zone.low, _Digits), DoubleToString(active_zone.high, _Digits));

   string txt = "";
   txt += "=== SupplyDemandPriceActionBot V4 ===\n";
   txt += StringFormat("Tendencia: %s\n", trend_txt);
   txt += StringFormat("Zona activa: %s\n", zone_txt);
   txt += "--- Indicadores ---\n";
   txt += StringFormat("ATR(%d): %s\n", InpAtrPeriod, DoubleToString(atr[0], _Digits + 1));
   txt += StringFormat("RSI(%d): %.2f %s\n", InpRSIPeriod, rsi[0],
                        rsi[0] >= InpRSIOverbought ? "(sobrecompra)" : (rsi[0] <= InpRSIOversold ? "(sobreventa)" : ""));
   txt += StringFormat("ADX(%d): %.2f  +DI:%.2f  -DI:%.2f  %s\n", InpADXPeriod, adx_main[0], plus_di[0], minus_di[0],
                        adx_main[0] >= InpADXMinStrength ? "(con tendencia)" : "(sin tendencia)");
   txt += StringFormat("MACD(%d,%d,%d): %s / señal %s  %s\n", InpMACDFastEMA, InpMACDSlowEMA, InpMACDSignalPeriod,
                        DoubleToString(macd_main[0], _Digits + 1), DoubleToString(macd_signal[0], _Digits + 1),
                        macd_main[0] > macd_signal[0] ? "(alcista)" : "(bajista)");

   if(InpUseIndicatorFilters && active_zone.valid && !active_zone.tested)
     {
      bool want_sell = active_zone.supply;
      bool confluence = IndicatorConfirmation(want_sell);
      txt += StringFormat("Confluencia para %s: %s\n", want_sell ? "VENTA" : "COMPRA", confluence ? "OK" : "insuficiente");
     }

   Comment(txt);
  }
