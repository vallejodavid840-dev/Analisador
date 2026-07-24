//+------------------------------------------------------------------+
//| SupplyDemandPriceActionBot_V5.mq5                                |
//| Educational EA: Supply & Demand + Price Action + Trade Management|
//| V5: multi-timeframe (M1 / M15 / H1 / H4) + más zonas activas +   |
//|     más oportunidades de entrada por semana, con los mismos      |
//|     filtros de calidad de la V4 (ATR14/RSI14/ADX14/MACD 12,26,9) |
//+------------------------------------------------------------------+
#property copyright "Botsito Optimizada"
#property version   "5.00"
#property strict
#property description "V5: pensado para operar en H1 pero analizando además H4 (tendencia de fondo), M15 (gatillo de entrada, revisado 4 veces por cada vela H1) y M1 (momentum inmediato). Sigue varias zonas de oferta/demanda a la vez en vez de una sola, invalida zonas solo cuando el precio realmente las rompe (ya no descarta una zona por un simple toque sin confirmar) y permite más de una operación simultánea. Mantiene los filtros ATR14/RSI14/ADX14/MACD(12,26,9) de la V4 para no sacrificar calidad por cantidad."

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
input double InpImpulseAtrMultiplier = 1.5;
input double InpZoneAtrPadding = 0.15;
input int InpZoneMaxAgeBars = 160;
input int InpMinBarsBeforeRetest = 3;
input bool InpDrawZones = true;
input bool InpInvalidateZoneAfterTrade = true;

input group "Multi-Timeframe (M1 / M15 / H1 / H4)"
input ENUM_TIMEFRAMES InpHigherTrendTimeframe = PERIOD_H4;  // tendencia de fondo
input ENUM_TIMEFRAMES InpEntryTimeframe = PERIOD_M15;        // gatillo de entrada (se revisa cada vela M15)
input ENUM_TIMEFRAMES InpMicroTimeframe = PERIOD_M1;         // momentum inmediato
input bool InpUseHTFTrendFilter = true;                      // usa H4 como voto extra de tendencia
input bool InpUseMicroConfirmation = true;                   // exige que el RSI de M1 esté girando a favor

input group "Zonas y frecuencia de operación"
input int InpMaxActiveZones = 3;          // cuántas zonas de oferta/demanda vigila a la vez
input int InpMaxConcurrentPositions = 2;  // operaciones simultáneas permitidas

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
input double InpRSIOverbought = 70.0;
input double InpRSIOversold = 30.0;
input bool InpUseRSIFilter = true;
input int InpADXPeriod = 14;
input double InpADXMinStrength = 18.0;
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

input group "Trade Management"
input bool InpUseBreakeven = true;
input double InpBreakevenRR = 1.0;
input int InpBreakevenLockPoints = 20;

input group "Cooldown"
input bool InpUseCooldown = true;
input int InpCooldownBarsAfterLoss = 2; // barras (del TF señal) de espera tras un SL

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

datetime last_bar_time = 0;       // último cierre de vela del TF señal (H1)
datetime last_entry_bar_time = 0; // último cierre de vela del TF de entrada (M15)
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

   if(atr_handle == INVALID_HANDLE || fast_ema_handle == INVALID_HANDLE || slow_ema_handle == INVALID_HANDLE ||
      rsi_handle == INVALID_HANDLE || adx_handle == INVALID_HANDLE || macd_handle == INVALID_HANDLE ||
      htf_fast_ema == INVALID_HANDLE || htf_slow_ema == INVALID_HANDLE || micro_rsi_handle == INVALID_HANDLE)
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
   Comment("");
  }

// Adjunta ATR14, RSI14, ADX14 y MACD(12,26,9) del TF señal como subventanas visibles.
// Las lecturas de H4/M15/M1 se muestran en el panel de texto (UpdateDashboard), porque
// MT5 no puede graficar velas de otro timeframe dentro del mismo chart.
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

   // El gatillo de entrada se revisa en el TF de entrada (M15 por defecto), no solo en
   // cada vela H1: así se comprueban ~4 velas M15 por cada vela H1, multiplicando las
   // oportunidades de detectar el rechazo en la zona sin esperar toda la hora.
   datetime entry_bar = iTime(_Symbol, InpEntryTimeframe, 0);
   if(entry_bar != last_entry_bar_time)
     {
      last_entry_bar_time = entry_bar;
      if(Bars(_Symbol, InpSignalTimeframe) >= InpLookbackBars + 20 && Bars(_Symbol, InpEntryTimeframe) >= 10)
         TryOpenTrade();
     }

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

// Guarda una zona nueva sin perder las que ya se están vigilando. Si el arreglo está
// lleno, recicla primero una zona inválida/ya operada y, si no hay ninguna, la más vieja.
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

// Recorre todas las zonas activas cada vela del TF señal (H1) y las invalida solo cuando
// el precio realmente las rompe (cierre más allá del borde) o cuando ya son demasiado
// viejas. A diferencia de la V3/V4, un simple toque sin confirmar ya NO mata la zona:
// así se aprovechan varios intentos de retest en vez de descartarla al primer fallo.
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

// Igual que en la V3/V4 pero ya no se detiene en la primera zona encontrada: agrega
// todas las zonas de impulso nuevas del lookback (hasta InpMaxActiveZones), para tener
// varias oportunidades vivas en vez de una sola.
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

// Tendencia del TF señal (H1): igual que en la V3/V4 (EMA50/200 y/o estructura de swings).
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

// NUEVO V5: tendencia del TF superior (H4 por defecto), vía EMA50/200 en ese timeframe.
int GetHigherTFTrend()
  {
   double fast[], slow[];
   ArraySetAsSeries(fast, true);
   ArraySetAsSeries(slow, true);
   if(CopyBuffer(htf_fast_ema, 0, 1, 2, fast) > 0 && CopyBuffer(htf_slow_ema, 0, 1, 2, slow) > 0)
      return fast[0] > slow[0] ? 1 : (fast[0] < slow[0] ? -1 : 0);
   return 0;
  }

// NUEVO V5: en vez de exigir "tendencia del TF señal == dirección" a secas (lo que en
// V3/V4 descartaba muchísimas operaciones cuando el TF señal estaba neutral), ahora
// también se permite entrar cuando el TF señal está neutral pero el TF superior (H4)
// sí tiene una tendencia clara a favor. Solo se veta cuando el TF señal está claramente
// en contra.
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

// Price action de rechazo, ahora parametrizada por timeframe: se usa con InpEntryTimeframe
// (M15 por defecto) para revisar el gatillo mucho más seguido que solo al cierre de H1.
bool BearishConfirmationTF(const ENUM_TIMEFRAMES tf, const Zone &zone)
  {
   double open1 = iOpen(_Symbol, tf, 1), close1 = iClose(_Symbol, tf, 1);
   double high1 = iHigh(_Symbol, tf, 1), low1 = iLow(_Symbol, tf, 1);
   double body = MathAbs(close1 - open1);

   if(!HasMinimumBody(body)) return false;

   double upper_wick = high1 - MathMax(open1, close1);
   bool pin = InpAllowPinBar && close1 < open1 && upper_wick / body >= InpMinWickToBodyRatio;
   bool engulf = InpAllowEngulfing && close1 < open1 && close1 < iOpen(_Symbol, tf, 2) && open1 > iClose(_Symbol, tf, 2);

   return pin || engulf || (close1 < open1 && high1 >= zone.low && low1 < zone.low);
  }

bool BullishConfirmationTF(const ENUM_TIMEFRAMES tf, const Zone &zone)
  {
   double open1 = iOpen(_Symbol, tf, 1), close1 = iClose(_Symbol, tf, 1);
   double high1 = iHigh(_Symbol, tf, 1), low1 = iLow(_Symbol, tf, 1);
   double body = MathAbs(close1 - open1);

   if(!HasMinimumBody(body)) return false;

   double lower_wick = MathMin(open1, close1) - low1;
   bool pin = InpAllowPinBar && close1 > open1 && lower_wick / body >= InpMinWickToBodyRatio;
   bool engulf = InpAllowEngulfing && close1 > open1 && close1 > iOpen(_Symbol, tf, 2) && open1 < iClose(_Symbol, tf, 2);

   return pin || engulf || (close1 > open1 && low1 <= zone.high && high1 > zone.high);
  }

// NUEVO V5: confluencia ATR/RSI/ADX/MACD (igual que V4) + un 4º voto opcional con la
// tendencia del TF superior (H4). Con más votos disponibles, alcanzar el mínimo
// configurado (por defecto 2) es más realista, así el filtro no ahoga la frecuencia.
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

// NUEVO V5: confirma que el momentum del TF micro (M1) ya está girando a favor de la
// operación (RSI subiendo para compras / bajando para ventas). Es la pieza que "anticipa"
// el giro de las velas en vez de esperar a que termine de formarse todo el patrón en M15.
bool MicroMomentumOk(const bool want_sell)
  {
   double rsi[];
   ArraySetAsSeries(rsi, true);
   if(CopyBuffer(micro_rsi_handle, 0, 1, 2, rsi) <= 0) return true; // fallback: no bloquear si falla

   return want_sell ? (rsi[0] < rsi[1]) : (rsi[0] > rsi[1]);
  }

// NUEVO V5: recorre TODAS las zonas activas (no solo la última) usando el TF de entrada
// (M15) para el toque/rechazo. Se llama en cada cierre de vela M15, así que cada zona
// tiene ~4 intentos de disparo por cada vela H1 en vez de 1 solo, y una zona que fue
// tocada sin confirmar sigue viva para el siguiente intento.
void TryOpenTrade()
  {
   if(zone_count <= 0) return;
   if(CountOpenPositions() >= InpMaxConcurrentPositions) return;
   if(SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) > InpMaxSpreadPoints) return;

   CheckLastClosedForCooldown();
   if(InpUseCooldown && TimeCurrent() < cooldown_until) return;

   double entry_high = iHigh(_Symbol, InpEntryTimeframe, 1);
   double entry_low = iLow(_Symbol, InpEntryTimeframe, 1);
   double entry_close = iClose(_Symbol, InpEntryTimeframe, 1);

   for(int i = 0; i < zone_count; i++)
     {
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

      double entry = want_sell ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double buffer = InpStopBufferPoints * _Point;
      double sl = want_sell ? zones[i].high + buffer : zones[i].low - buffer;
      double risk_distance = MathAbs(entry - sl);
      if(risk_distance <= 0) continue;

      double tp = want_sell ? entry - (risk_distance * InpRewardRiskRatio) : entry + (risk_distance * InpRewardRiskRatio);
      double lots = CalculateLots(risk_distance);
      if(lots <= 0) continue;

      bool sent = want_sell ? trade.Sell(lots, _Symbol, entry, sl, tp, "Supply rejection sell")
                            : trade.Buy(lots, _Symbol, entry, sl, tp, "Demand rejection buy");

      if(sent)
        {
         zones[i].tested = true;
         if(CountOpenPositions() >= InpMaxConcurrentPositions) break;
        }
     }
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

// Panel de texto con la lectura de las 4 timeframes (H4/H1/M15/M1) y de los 4
// indicadores (ATR/RSI/ADX/MACD), más el estado de todas las zonas vigiladas.
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
   txt += "=== SupplyDemandPriceActionBot V5 (Multi-TF) ===\n";
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
   txt += StringFormat("Posiciones abiertas: %d/%d\n", CountOpenPositions(), InpMaxConcurrentPositions);

   Comment(txt);
  }
