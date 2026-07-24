//+------------------------------------------------------------------+
//| SupplyDemandPriceActionBot_V6.mq5                                |
//| Educational EA: Supply & Demand + Price Action + Trade Management|
//| V6: SL "dinámico" que sigue al precio sin TP fijo (deja correr    |
//|     las ganancias), + entradas de continuación de tendencia      |
//|     (pullback a EMA) sumadas a las zonas de oferta/demanda para  |
//|     operar con más frecuencia.                                   |
//+------------------------------------------------------------------+
#property copyright "Botsito Optimizada"
#property version   "6.00"
#property strict
#property description "V6: soluciona el problema de cerrar en un TP fijo mientras el precio seguía corriendo. Ahora, en vez de un take-profit fijo, el SL se mueve detrás del precio (trailing por ATR): mientras el precio siga a favor el SL lo sigue de cerca pero SIN cerrar la operación; si el precio retrocede, cierra al tocar ese SL, siempre con ganancia una vez que el trailing arrancó. Además suma una segunda fuente de señales (pullback a una EMA a favor de la tendencia H1/H4) a las zonas de oferta/demanda de la V5, para operar con más frecuencia sin bajar la exigencia de los filtros ATR14/RSI14/ADX14/MACD(12,26,9)."

#include <Trade/Trade.mqh>

CTrade trade;

enum ENUM_TREND_FILTER
  {
   TREND_EMA = 0,
   TREND_STRUCTURE = 1,
   TREND_BOTH = 2
  };

input group "Strategy (Timeframe principal: construcción de zonas)"
input ENUM_TIMEFRAMES InpSignalTimeframe = PERIOD_H1;
input ENUM_TREND_FILTER InpTrendFilter = TREND_BOTH;
input int InpLookbackBars = 220;
input int InpSwingDepth = 3;
input int InpAtrPeriod = 14;
input double InpImpulseAtrMultiplier = 1.2;
input double InpZoneAtrPadding = 0.15;
input int InpZoneMaxAgeBars = 200;
input int InpMinBarsBeforeRetest = 2;
input bool InpDrawZones = true;
input bool InpInvalidateZoneAfterTrade = true;

input group "Multi-Timeframe (M1 / M15 / H1 / H4)"
input ENUM_TIMEFRAMES InpHigherTrendTimeframe = PERIOD_H4;
input ENUM_TIMEFRAMES InpEntryTimeframe = PERIOD_M15;
input ENUM_TIMEFRAMES InpMicroTimeframe = PERIOD_M1;
input bool InpUseHTFTrendFilter = true;
input bool InpUseMicroConfirmation = true;

input group "Zonas y frecuencia de operación"
input int InpMaxActiveZones = 5;          // cuántas zonas de oferta/demanda vigila a la vez
input int InpMaxConcurrentPositions = 3;  // operaciones simultáneas permitidas

input group "Continuación de tendencia (pullback a EMA, señal extra)"
input bool InpUseTrendContinuation = true;    // suma entradas de pullback además de las zonas
input int InpPullbackEmaPeriod = 20;          // EMA (TF de entrada) usada como imán de pullback
input int InpPullbackSwingLookback = 12;      // barras (TF de entrada) para el SL por swing

input group "Price Action Confirmation"
input double InpMinWickToBodyRatio = 1.5;
input double InpMinBodyAtrRatio = 0.15;
input bool InpAllowEngulfing = true;
input bool InpAllowPinBar = true;
input bool InpRequireCloseOutsideZone = true;

input group "Indicator Confirmation (ATR14 / RSI14 / ADX14 / MACD 12,26,9)"
input bool InpShowIndicatorsOnChart = true;
input bool InpShowDashboard = true;
input bool InpUseIndicatorFilters = true;
input int InpMinIndicatorConfirmations = 2;  // mínimo de votos a favor (de hasta 4: ADX, RSI, MACD, H4)
input int InpRSIPeriod = 14;
input double InpRSIOverbought = 72.0;
input double InpRSIOversold = 28.0;
input bool InpUseRSIFilter = true;
input int InpADXPeriod = 14;
input double InpADXMinStrength = 18.0;
input bool InpUseADXFilter = true;
input bool InpADXHardVeto = false;   // false = ADX solo suma/resta voto; true = bloquea entradas si el mercado no tiene tendencia
input int InpMACDFastEMA = 12;
input int InpMACDSlowEMA = 26;
input int InpMACDSignalPeriod = 9;
input bool InpUseMACDFilter = true;

input group "Risk Management"
input double InpRiskPercent = 1.0;
input double InpFixedLots = 0.0;
input double InpRewardRiskRatio = 2.0;   // solo se usa si InpUseInfiniteTP = false
input int InpMaxSpreadPoints = 35;
input int InpStopBufferPoints = 30;
input int InpMagicNumber = 260724;
input int InpSlippagePoints = 20;

input group "Salida: SL dinámico en vez de TP fijo (dejar correr las ganancias)"
input bool InpUseInfiniteTP = true;          // true = sin take-profit fijo, solo el trailing cierra la operación
input bool InpUseTrailingStop = true;        // true = el SL sigue al precio por ATR una vez en ganancia
input double InpTrailStartAtrMultiplier = 0.8; // cuánta ganancia (en ATR) hace falta para empezar a mover el SL
input double InpTrailAtrMultiplier = 2.0;      // qué tan lejos del precio actual se mantiene el SL mientras sigue
input bool InpUseBreakeven = true;             // red de seguridad si el trailing está desactivado
input double InpBreakevenRR = 1.0;             // ganancia (en múltiplos del riesgo inicial) para mover a breakeven
input int InpBreakevenLockPoints = 20;         // puntos de ganancia asegurados al mover a breakeven

input group "Cooldown"
input bool InpUseCooldown = true;
input int InpCooldownBarsAfterLoss = 2;

struct Zone
  {
   bool valid;
   bool tested;
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
int htf_fast_ema = INVALID_HANDLE;
int htf_slow_ema = INVALID_HANDLE;
int micro_rsi_handle = INVALID_HANDLE;
int entry_ema_handle = INVALID_HANDLE;

datetime last_bar_time = 0;
datetime last_entry_bar_time = 0;
datetime cooldown_until = 0;

Zone zones[];
int zone_count = 0;

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
   htf_fast_ema = iMA(_Symbol, InpHigherTrendTimeframe, 50, 0, MODE_EMA, PRICE_CLOSE);
   htf_slow_ema = iMA(_Symbol, InpHigherTrendTimeframe, 200, 0, MODE_EMA, PRICE_CLOSE);
   micro_rsi_handle = iRSI(_Symbol, InpMicroTimeframe, InpRSIPeriod, PRICE_CLOSE);
   entry_ema_handle = iMA(_Symbol, InpEntryTimeframe, InpPullbackEmaPeriod, 0, MODE_EMA, PRICE_CLOSE);

   if(atr_handle == INVALID_HANDLE || fast_ema_handle == INVALID_HANDLE || slow_ema_handle == INVALID_HANDLE ||
      rsi_handle == INVALID_HANDLE || adx_handle == INVALID_HANDLE || macd_handle == INVALID_HANDLE ||
      htf_fast_ema == INVALID_HANDLE || htf_slow_ema == INVALID_HANDLE || micro_rsi_handle == INVALID_HANDLE ||
      entry_ema_handle == INVALID_HANDLE)
      return INIT_FAILED;

   ArrayResize(zones, MathMax(1, InpMaxActiveZones));
   zone_count = 0;
   for(int i = 0; i < ArraySize(zones); i++)
     {
      zones[i].valid = false;
      zones[i].tested = false;
     }

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
   if(htf_fast_ema != INVALID_HANDLE) IndicatorRelease(htf_fast_ema);
   if(htf_slow_ema != INVALID_HANDLE) IndicatorRelease(htf_slow_ema);
   if(micro_rsi_handle != INVALID_HANDLE) IndicatorRelease(micro_rsi_handle);
   if(entry_ema_handle != INVALID_HANDLE) IndicatorRelease(entry_ema_handle);
   Comment("");
  }

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

   datetime signal_bar = iTime(_Symbol, InpSignalTimeframe, 0);
   if(signal_bar != last_bar_time)
     {
      last_bar_time = signal_bar;
      if(Bars(_Symbol, InpSignalTimeframe) >= InpLookbackBars + 20)
        {
         InvalidateBrokenZones();
         UpdateZones();
        }
     }

   datetime entry_bar = iTime(_Symbol, InpEntryTimeframe, 0);
   if(entry_bar != last_entry_bar_time)
     {
      last_entry_bar_time = entry_bar;
      if(Bars(_Symbol, InpSignalTimeframe) >= InpLookbackBars + 20 && Bars(_Symbol, InpEntryTimeframe) >= InpPullbackSwingLookback + 5)
         TryOpenTrade();
     }

   if(InpShowDashboard) UpdateDashboard();
  }

// NUEVO V6: reemplaza el "breakeven de un solo movimiento" de la V3-V5 (que solo movía el
// SL una vez y luego se quedaba quieto aunque el precio siguiera corriendo) por un trailing
// continuo basado en ATR. Mientras el precio avance a favor, el SL lo sigue de cerca sin
// cerrar la operación; si el precio se da vuelta, cierra al tocar ese SL, pero como el SL
// nunca retrocede, una vez que arrancó a moverse la operación ya solo puede cerrar en cero
// (breakeven) o en ganancia, nunca en la pérdida original.
void ManageOpenTrades()
  {
   if(!InpUseTrailingStop && !InpUseBreakeven) return;

   double atr[];
   ArraySetAsSeries(atr, true);
   bool atr_ok = InpUseTrailingStop && CopyBuffer(atr_handle, 0, 0, 1, atr) > 0 && atr[0] > 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(!(PositionSelectByTicket(ticket) && PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == InpMagicNumber))
         continue;

      double open_price = PositionGetDouble(POSITION_PRICE_OPEN);
      double current_sl = PositionGetDouble(POSITION_SL);
      double current_tp = PositionGetDouble(POSITION_TP);
      long type = PositionGetInteger(POSITION_TYPE);

      if(type == POSITION_TYPE_BUY)
        {
         double current_price = SymbolInfoDouble(_Symbol, SYMBOL_BID);

         if(atr_ok)
           {
            double trail_trigger = open_price + InpTrailStartAtrMultiplier * atr[0];
            if(current_price >= trail_trigger)
              {
               double breakeven_sl = open_price + InpBreakevenLockPoints * _Point;
               double trail_sl = current_price - InpTrailAtrMultiplier * atr[0];
               double new_sl = MathMax(breakeven_sl, trail_sl);
               if(current_sl == 0 || new_sl > current_sl)
                  trade.PositionModify(ticket, NormalizeDouble(new_sl, _Digits), current_tp);
               continue;
              }
           }

         if(InpUseBreakeven && current_sl < open_price && current_sl != 0)
           {
            double risk = MathAbs(open_price - current_sl);
            if(risk > 0)
              {
               double target_price = open_price + (risk * InpBreakevenRR);
               if(current_price >= target_price)
                 {
                  double new_sl = open_price + (InpBreakevenLockPoints * _Point);
                  trade.PositionModify(ticket, new_sl, current_tp);
                 }
              }
           }
        }
      else if(type == POSITION_TYPE_SELL)
        {
         double current_price = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

         if(atr_ok)
           {
            double trail_trigger = open_price - InpTrailStartAtrMultiplier * atr[0];
            if(current_price <= trail_trigger)
              {
               double breakeven_sl = open_price - InpBreakevenLockPoints * _Point;
               double trail_sl = current_price + InpTrailAtrMultiplier * atr[0];
               double new_sl = MathMin(breakeven_sl, trail_sl);
               if(current_sl == 0 || new_sl < current_sl)
                  trade.PositionModify(ticket, NormalizeDouble(new_sl, _Digits), current_tp);
               continue;
              }
           }

         if(InpUseBreakeven && current_sl > open_price && current_sl != 0)
           {
            double risk = MathAbs(open_price - current_sl);
            if(risk > 0)
              {
               double target_price = open_price - (risk * InpBreakevenRR);
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
      break;
     }
  }

bool ZoneExists(const datetime created, const bool supply)
  {
   for(int i = 0; i < zone_count; i++)
      if(zones[i].valid && zones[i].created == created && zones[i].supply == supply)
         return true;
   return false;
  }

void AddZone(const Zone &z)
  {
   if(ZoneExists(z.created, z.supply)) return;

   int slot = -1;
   if(zone_count < ArraySize(zones))
     {
      slot = zone_count;
      zone_count++;
     }
   else
     {
      datetime oldest = D'3000.01.01 00:00';
      int oldest_idx = 0;
      for(int i = 0; i < zone_count; i++)
        {
         if(!zones[i].valid || zones[i].tested) { slot = i; break; }
         if(zones[i].created < oldest) { oldest = zones[i].created; oldest_idx = i; }
        }
      if(slot == -1) slot = oldest_idx;
     }

   zones[slot] = z;
   DrawZone(zones[slot]);
  }

void InvalidateBrokenZones()
  {
   double close1 = iClose(_Symbol, InpSignalTimeframe, 1);
   for(int i = 0; i < zone_count; i++)
     {
      if(!zones[i].valid || zones[i].tested) continue;

      int age = iBarShift(_Symbol, InpSignalTimeframe, zones[i].created);
      if(age < 0 || age > InpZoneMaxAgeBars) { zones[i].valid = false; continue; }

      if(zones[i].supply && close1 > zones[i].high) { zones[i].valid = false; continue; }
      if(!zones[i].supply && close1 < zones[i].low) { zones[i].valid = false; continue; }
     }
  }

void UpdateZones()
  {
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

      datetime created = iTime(_Symbol, InpSignalTimeframe, base_shift);
      if(ZoneExists(created, bearish_impulse)) continue;

      Zone z;
      z.valid = true;
      z.tested = false;
      z.supply = bearish_impulse;
      z.created = created;
      z.created_shift = base_shift;
      double pad = atr[shift] * InpZoneAtrPadding;
      z.high = iHigh(_Symbol, InpSignalTimeframe, base_shift) + pad;
      z.low = iLow(_Symbol, InpSignalTimeframe, base_shift) - pad;
      z.name = StringFormat("SD_PA_%s_%I64d", z.supply ? "SUPPLY" : "DEMAND", (long)z.created);

      AddZone(z);
     }
  }

int CountOpenPositions()
  {
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(PositionSelectByTicket(ticket) && PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
         count++;
     }
   return count;
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

int GetHigherTFTrend()
  {
   double fast[], slow[];
   ArraySetAsSeries(fast, true);
   ArraySetAsSeries(slow, true);
   if(CopyBuffer(htf_fast_ema, 0, 1, 2, fast) > 0 && CopyBuffer(htf_slow_ema, 0, 1, 2, slow) > 0)
      return fast[0] > slow[0] ? 1 : (fast[0] < slow[0] ? -1 : 0);
   return 0;
  }

bool CombinedTrendOk(const bool want_sell)
  {
   int strend = GetTrendDirection();
   if(want_sell)
     {
      if(strend < 0) return true;
      if(strend == 0 && InpUseHTFTrendFilter && GetHigherTFTrend() < 0) return true;
      return false;
     }
   else
     {
      if(strend > 0) return true;
      if(strend == 0 && InpUseHTFTrendFilter && GetHigherTFTrend() > 0) return true;
      return false;
     }
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

bool HasMinimumBody(const double body)
  {
   double atr[];
   ArraySetAsSeries(atr, true);
   if(CopyBuffer(atr_handle, 0, 1, 2, atr) <= 0) return true;
   return body >= atr[0] * InpMinBodyAtrRatio;
  }

// Patrón de rechazo puro (pinbar/envolvente), sin depender de una zona. Se reutiliza tanto
// para el borde de las zonas de oferta/demanda como para las entradas de continuación.
bool PinOrEngulfBearish(const ENUM_TIMEFRAMES tf)
  {
   double open1 = iOpen(_Symbol, tf, 1), close1 = iClose(_Symbol, tf, 1);
   double high1 = iHigh(_Symbol, tf, 1), low1 = iLow(_Symbol, tf, 1);
   double body = MathAbs(close1 - open1);
   if(!HasMinimumBody(body)) return false;

   double upper_wick = high1 - MathMax(open1, close1);
   bool pin = InpAllowPinBar && close1 < open1 && upper_wick / body >= InpMinWickToBodyRatio;
   bool engulf = InpAllowEngulfing && close1 < open1 && close1 < iOpen(_Symbol, tf, 2) && open1 > iClose(_Symbol, tf, 2);
   return pin || engulf;
  }

bool PinOrEngulfBullish(const ENUM_TIMEFRAMES tf)
  {
   double open1 = iOpen(_Symbol, tf, 1), close1 = iClose(_Symbol, tf, 1);
   double high1 = iHigh(_Symbol, tf, 1), low1 = iLow(_Symbol, tf, 1);
   double body = MathAbs(close1 - open1);
   if(!HasMinimumBody(body)) return false;

   double lower_wick = MathMin(open1, close1) - low1;
   bool pin = InpAllowPinBar && close1 > open1 && lower_wick / body >= InpMinWickToBodyRatio;
   bool engulf = InpAllowEngulfing && close1 > open1 && close1 > iOpen(_Symbol, tf, 2) && open1 < iClose(_Symbol, tf, 2);
   return pin || engulf;
  }

bool BearishConfirmationTF(const ENUM_TIMEFRAMES tf, const Zone &zone)
  {
   double close1 = iClose(_Symbol, tf, 1), open1 = iOpen(_Symbol, tf, 1);
   double high1 = iHigh(_Symbol, tf, 1), low1 = iLow(_Symbol, tf, 1);
   return PinOrEngulfBearish(tf) || (close1 < open1 && high1 >= zone.low && low1 < zone.low);
  }

bool BullishConfirmationTF(const ENUM_TIMEFRAMES tf, const Zone &zone)
  {
   double close1 = iClose(_Symbol, tf, 1), open1 = iOpen(_Symbol, tf, 1);
   double high1 = iHigh(_Symbol, tf, 1), low1 = iLow(_Symbol, tf, 1);
   return PinOrEngulfBullish(tf) || (close1 > open1 && low1 <= zone.high && high1 > zone.high);
  }

// NUEVO V6: ADX ahora puede ser un voto suave (InpADXHardVeto = false, por defecto) en vez de
// un veto duro, para no bloquear tantas entradas en mercados con tendencia moderada.
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

      if(InpADXHardVeto && adx_main[0] < InpADXMinStrength) return false;

      needed++;
      bool strong_enough = adx_main[0] >= InpADXMinStrength;
      bool dir_ok = want_sell ? (minus_di[0] > plus_di[0]) : (plus_di[0] > minus_di[0]);
      if(strong_enough && dir_ok) confirmations++;
     }

   if(InpUseRSIFilter)
     {
      double rsi[];
      ArraySetAsSeries(rsi, true);
      if(CopyBuffer(rsi_handle, 0, 1, 1, rsi) <= 0) return false;

      if(want_sell && rsi[0] <= InpRSIOversold) return false;
      if(!want_sell && rsi[0] >= InpRSIOverbought) return false;

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

   if(InpUseHTFTrendFilter)
     {
      needed++;
      int htrend = GetHigherTFTrend();
      bool trend_ok = want_sell ? (htrend < 0) : (htrend > 0);
      if(trend_ok) confirmations++;
     }

   if(needed == 0) return true;
   int required = MathMax(1, MathMin(needed, InpMinIndicatorConfirmations));
   return confirmations >= required;
  }

bool MicroMomentumOk(const bool want_sell)
  {
   double rsi[];
   ArraySetAsSeries(rsi, true);
   if(CopyBuffer(micro_rsi_handle, 0, 1, 2, rsi) <= 0) return true;

   return want_sell ? (rsi[0] < rsi[1]) : (rsi[0] > rsi[1]);
  }

// Envía la orden con SL calculado y, si InpUseInfiniteTP está activo, SIN take-profit fijo
// (tp = 0): la salida queda 100% en manos del trailing por ATR de ManageOpenTrades().
bool SendTrade(const bool want_sell, const double sl_raw, const string comment)
  {
   double entry = want_sell ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double buffer = InpStopBufferPoints * _Point;
   double sl = want_sell ? sl_raw + buffer : sl_raw - buffer;
   double risk_distance = MathAbs(entry - sl);
   if(risk_distance <= 0) return false;

   double tp = 0;
   if(!InpUseInfiniteTP)
      tp = want_sell ? entry - (risk_distance * InpRewardRiskRatio) : entry + (risk_distance * InpRewardRiskRatio);

   double lots = CalculateLots(risk_distance);
   if(lots <= 0) return false;

   return want_sell ? trade.Sell(lots, _Symbol, entry, sl, tp, comment)
                     : trade.Buy(lots, _Symbol, entry, sl, tp, comment);
  }

// Recorre TODAS las zonas activas usando el TF de entrada (M15) para el toque/rechazo.
void TryZoneTrades()
  {
   if(zone_count <= 0) return;

   double entry_high = iHigh(_Symbol, InpEntryTimeframe, 1);
   double entry_low = iLow(_Symbol, InpEntryTimeframe, 1);
   double entry_close = iClose(_Symbol, InpEntryTimeframe, 1);

   for(int i = 0; i < zone_count; i++)
     {
      if(CountOpenPositions() >= InpMaxConcurrentPositions) return;
      if(!zones[i].valid) continue;
      if(zones[i].tested && InpInvalidateZoneAfterTrade) continue;

      int age = iBarShift(_Symbol, InpSignalTimeframe, zones[i].created);
      if(age < InpMinBarsBeforeRetest) continue;

      bool want_sell = zones[i].supply;
      if(!CombinedTrendOk(want_sell)) continue;

      bool touched = entry_high >= zones[i].low && entry_low <= zones[i].high;
      if(!touched) continue;

      bool rejected = want_sell ? BearishConfirmationTF(InpEntryTimeframe, zones[i]) : BullishConfirmationTF(InpEntryTimeframe, zones[i]);
      if(!rejected) continue;

      if(InpRequireCloseOutsideZone)
        {
         if(want_sell && entry_close > zones[i].low) continue;
         if(!want_sell && entry_close < zones[i].high) continue;
        }

      if(InpUseIndicatorFilters && !IndicatorConfirmation(want_sell)) continue;
      if(InpUseMicroConfirmation && !MicroMomentumOk(want_sell)) continue;

      double sl_raw = want_sell ? zones[i].high : zones[i].low;
      if(SendTrade(want_sell, sl_raw, want_sell ? "Supply rejection sell" : "Demand rejection buy"))
         zones[i].tested = true;
     }
  }

// NUEVO V6: segunda fuente de señales, independiente de las zonas de oferta/demanda:
// pullback a una EMA a favor de la tendencia H1/H4, con vela de rechazo + los mismos
// filtros de indicadores. El objetivo es sumar operaciones en tramos de tendencia limpia
// donde no aparece un impulso lo bastante fuerte como para dejar una zona de oferta/demanda.
void TryTrendContinuationTrade()
  {
   if(!InpUseTrendContinuation) return;
   if(CountOpenPositions() >= InpMaxConcurrentPositions) return;

   int strend = GetTrendDirection();
   if(strend == 0) return; // esta señal exige tendencia clara en el TF señal, a diferencia de las zonas

   bool want_sell = strend < 0;
   if(InpUseHTFTrendFilter)
     {
      int htrend = GetHigherTFTrend();
      if(htrend != 0 && ((want_sell && htrend > 0) || (!want_sell && htrend < 0))) return; // H4 contradice a H1
     }

   double ema[];
   ArraySetAsSeries(ema, true);
   if(CopyBuffer(entry_ema_handle, 0, 1, 1, ema) <= 0) return;

   double high1 = iHigh(_Symbol, InpEntryTimeframe, 1);
   double low1 = iLow(_Symbol, InpEntryTimeframe, 1);
   double close1 = iClose(_Symbol, InpEntryTimeframe, 1);

   bool touched_ema = high1 >= ema[0] && low1 <= ema[0];
   if(!touched_ema) return;

   bool rejected = want_sell ? PinOrEngulfBearish(InpEntryTimeframe) : PinOrEngulfBullish(InpEntryTimeframe);
   if(!rejected) return;

   if(want_sell && close1 > ema[0]) return;   // debe cerrar del lado de la tendencia
   if(!want_sell && close1 < ema[0]) return;

   if(InpUseIndicatorFilters && !IndicatorConfirmation(want_sell)) return;
   if(InpUseMicroConfirmation && !MicroMomentumOk(want_sell)) return;

   double sl_raw = want_sell ? SwingHighEntryTF(InpPullbackSwingLookback) : SwingLowEntryTF(InpPullbackSwingLookback);
   SendTrade(want_sell, sl_raw, want_sell ? "Trend pullback sell" : "Trend pullback buy");
  }

double SwingHighEntryTF(const int lookback)
  {
   double best = iHigh(_Symbol, InpEntryTimeframe, 1);
   for(int i = 2; i <= lookback; i++)
      best = MathMax(best, iHigh(_Symbol, InpEntryTimeframe, i));
   return best;
  }

double SwingLowEntryTF(const int lookback)
  {
   double best = iLow(_Symbol, InpEntryTimeframe, 1);
   for(int i = 2; i <= lookback; i++)
      best = MathMin(best, iLow(_Symbol, InpEntryTimeframe, i));
   return best;
  }

void TryOpenTrade()
  {
   if(CountOpenPositions() >= InpMaxConcurrentPositions) return;
   if(SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) > InpMaxSpreadPoints) return;

   CheckLastClosedForCooldown();
   if(InpUseCooldown && TimeCurrent() < cooldown_until) return;

   TryZoneTrades();
   TryTrendContinuationTrade();
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

string TimeframeToString(const ENUM_TIMEFRAMES tf)
  {
   string s = EnumToString(tf);
   StringReplace(s, "PERIOD_", "");
   return s;
  }

string TrendText(const int t)
  {
   return t > 0 ? "ALCISTA" : (t < 0 ? "BAJISTA" : "NEUTRAL");
  }

void UpdateDashboard()
  {
   double atr[], rsi[], adx_main[], plus_di[], minus_di[], macd_main[], macd_signal[], micro_rsi[];
   ArraySetAsSeries(atr, true);
   ArraySetAsSeries(rsi, true);
   ArraySetAsSeries(adx_main, true);
   ArraySetAsSeries(plus_di, true);
   ArraySetAsSeries(minus_di, true);
   ArraySetAsSeries(macd_main, true);
   ArraySetAsSeries(macd_signal, true);
   ArraySetAsSeries(micro_rsi, true);

   bool ok = true;
   ok = ok && CopyBuffer(atr_handle, 0, 1, 1, atr) > 0;
   ok = ok && CopyBuffer(rsi_handle, 0, 1, 1, rsi) > 0;
   ok = ok && CopyBuffer(adx_handle, MAIN_LINE, 1, 1, adx_main) > 0;
   ok = ok && CopyBuffer(adx_handle, PLUSDI_LINE, 1, 1, plus_di) > 0;
   ok = ok && CopyBuffer(adx_handle, MINUSDI_LINE, 1, 1, minus_di) > 0;
   ok = ok && CopyBuffer(macd_handle, MAIN_LINE, 1, 1, macd_main) > 0;
   ok = ok && CopyBuffer(macd_handle, SIGNAL_LINE, 1, 1, macd_signal) > 0;
   if(!ok) return;

   bool micro_ok = CopyBuffer(micro_rsi_handle, 0, 1, 2, micro_rsi) > 0;

   int strend = GetTrendDirection();
   int htrend = GetHigherTFTrend();

   string txt = "";
   txt += "=== SupplyDemandPriceActionBot V6 (SL dinámico) ===\n";
   txt += StringFormat("TF señal:%s  TF entrada:%s  TF tendencia:%s  TF micro:%s\n",
                        TimeframeToString(InpSignalTimeframe), TimeframeToString(InpEntryTimeframe),
                        TimeframeToString(InpHigherTrendTimeframe), TimeframeToString(InpMicroTimeframe));
   txt += StringFormat("Tendencia %s: %s   |   Tendencia %s: %s\n",
                        TimeframeToString(InpSignalTimeframe), TrendText(strend),
                        TimeframeToString(InpHigherTrendTimeframe), TrendText(htrend));
   if(micro_ok)
      txt += StringFormat("Momentum %s (RSI): %.2f -> %.2f  %s\n", TimeframeToString(InpMicroTimeframe),
                           micro_rsi[1], micro_rsi[0], micro_rsi[0] > micro_rsi[1] ? "(girando arriba)" : "(girando abajo)");

   txt += "--- Indicadores (" + TimeframeToString(InpSignalTimeframe) + ") ---\n";
   txt += StringFormat("ATR(%d): %s\n", InpAtrPeriod, DoubleToString(atr[0], _Digits + 1));
   txt += StringFormat("RSI(%d): %.2f %s\n", InpRSIPeriod, rsi[0],
                        rsi[0] >= InpRSIOverbought ? "(sobrecompra)" : (rsi[0] <= InpRSIOversold ? "(sobreventa)" : ""));
   txt += StringFormat("ADX(%d): %.2f  +DI:%.2f  -DI:%.2f  %s\n", InpADXPeriod, adx_main[0], plus_di[0], minus_di[0],
                        adx_main[0] >= InpADXMinStrength ? "(con tendencia)" : "(sin tendencia)");
   txt += StringFormat("MACD(%d,%d,%d): %s / señal %s  %s\n", InpMACDFastEMA, InpMACDSlowEMA, InpMACDSignalPeriod,
                        DoubleToString(macd_main[0], _Digits + 1), DoubleToString(macd_signal[0], _Digits + 1),
                        macd_main[0] > macd_signal[0] ? "(alcista)" : "(bajista)");

   int active_count = 0;
   for(int i = 0; i < zone_count; i++) if(zones[i].valid) active_count++;
   txt += StringFormat("--- Zonas vigiladas: %d/%d ---\n", active_count, ArraySize(zones));
   for(int i = 0; i < zone_count; i++)
     {
      if(!zones[i].valid) continue;
      txt += StringFormat(" [%d] %s %s  %s - %s\n", i, zones[i].supply ? "OFERTA" : "DEMANDA",
                           zones[i].tested ? "operada" : "activa",
                           DoubleToString(zones[i].low, _Digits), DoubleToString(zones[i].high, _Digits));
     }

   txt += StringFormat("--- Posiciones abiertas: %d/%d ---\n", CountOpenPositions(), InpMaxConcurrentPositions);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(!(PositionSelectByTicket(ticket) && PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == InpMagicNumber))
         continue;
      double open_price = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl = PositionGetDouble(POSITION_SL);
      double profit = PositionGetDouble(POSITION_PROFIT);
      long type = PositionGetInteger(POSITION_TYPE);
      txt += StringFormat(" #%I64u %s  entrada:%s  SL actual:%s  flotante:%.2f\n", ticket,
                           type == POSITION_TYPE_BUY ? "BUY" : "SELL",
                           DoubleToString(open_price, _Digits), DoubleToString(sl, _Digits), profit);
     }

   Comment(txt);
  }
