"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries, CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesType, type Time, type UTCTimestamp, type SeriesMarker,
} from "lightweight-charts";
import clsx from "clsx";
import { CandlestickChart, LineChart, AreaChart, Activity, Minus, TrendingUp, Trash2, Maximize2, Minimize2, MousePointer2 } from "lucide-react";
import { bollinger, buyerSellerRatio, closes, ema, macd, momentum, rsi, sma, volumeProfile, vwap } from "@/lib/analytics/indicators";
import { largeTradeThreshold } from "@/lib/analytics/signals";
import { formatNumber, formatPct, formatPrice, formatTime, formatUsd } from "@/lib/format";
import { useLocalStore } from "@/hooks/useLocalStore";
import { DataStatus } from "../ui/DataStatus";
import { RESOLUTIONS, useCandleFeed, type Feed } from "./useCandleFeed";
import type { Candle } from "@/lib/types";

type ChartType = "candles" | "line" | "area";
export type IndicatorId = "vol" | "ma20" | "ma50" | "ema21" | "bb" | "vwap" | "rsi" | "macd" | "bsr" | "mom" | "vp" | "markers";

const INDICATORS: { id: IndicatorId; label: string; group: string; hint: string }[] = [
  { id: "vol", label: "Volume", group: "Overlays", hint: "Traded volume per candle" },
  { id: "ma20", label: "MA 20", group: "Overlays", hint: "Simple moving average (20)" },
  { id: "ma50", label: "MA 50", group: "Overlays", hint: "Simple moving average (50)" },
  { id: "ema21", label: "EMA 21", group: "Overlays", hint: "Exponential moving average (21)" },
  { id: "bb", label: "Bollinger Bands", group: "Overlays", hint: "20-period SMA ± 2σ" },
  { id: "vwap", label: "VWAP", group: "Overlays", hint: "Volume-weighted average price (visible session)" },
  { id: "vp", label: "Volume Profile", group: "Overlays", hint: "Volume traded at each price level in view" },
  { id: "markers", label: "Large Trades", group: "Overlays", hint: "Live markers for unusually large trades" },
  { id: "rsi", label: "RSI 14", group: "Oscillators", hint: "Relative Strength Index (Wilder, 14)" },
  { id: "macd", label: "MACD", group: "Oscillators", hint: "MACD (12, 26, 9)" },
  { id: "bsr", label: "Buyer/Seller Ratio", group: "ShareBajar", hint: "Share of volume from aggressive buyers (taker buys), smoothed" },
  { id: "mom", label: "Momentum", group: "ShareBajar", hint: "Rate of change over 10 candles (%)" },
];

const COLORS = { ma20: "#f5b83d", ma50: "#8b7bff", ema21: "#38bdf8", bb: "#64748b", vwap: "#f472b6", rsi: "#a78bfa", macd: "#38bdf8", signal: "#f5b83d", bsr: "#22d3ee", mom: "#fb923c" };

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const ts = (t: number) => t as UTCTimestamp;
const line = (cs: Candle[], vals: (number | null)[]) => cs.map((c, i) => (vals[i] === null || vals[i] === undefined ? { time: ts(c.time) } : { time: ts(c.time), value: vals[i] as number }));

interface Props {
  feed: Feed;
  label?: string;
  defaultRes?: string;
  height?: number;
  className?: string;
  compact?: boolean;
}

export function ProChart({ feed, label, defaultRes, height = 520, className, compact }: Props) {
  const resList = RESOLUTIONS[feed.kind];
  const [res, setRes] = useState(defaultRes && resList.includes(defaultRes) ? defaultRes : "1m");
  const [prefs, setPrefs] = useLocalStore<{ type: ChartType; ind: IndicatorId[] }>("sb.chart.prefs.v1", { type: "candles", ind: ["vol", "ma20", "markers"] });
  const type: ChartType = prefs.type;
  const ind = useMemo(() => new Set(prefs.ind), [prefs.ind]);
  const [tool, setTool] = useState<"none" | "hline" | "trend">("none");
  const [hlines, setHlines] = useState<number[]>([]);
  const [trends, setTrends] = useState<{ t1: number; p1: number; t2: number; p2: number }[]>([]);
  const [menu, setMenu] = useState(false);
  const [legend, setLegend] = useState<Candle | null>(null);
  const [theme, setTheme] = useState(0);
  const [full, setFull] = useState(false);
  const [vp, setVp] = useState<{ top: number; h: number; w: number; buy: number }[]>([]);

  const feedState = useCandleFeed(feed, res, { trades: ind.has("markers") });
  const { candles, trades } = feedState;

  const wrapRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const seriesRef = useRef<Record<string, ISeriesApi<SeriesType>>>({});
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const trendSeriesRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const lastShape = useRef<{ len: number; first: number; last: number } | null>(null);
  const pendingTrend = useRef<{ t: number; p: number } | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const candlesRef = useRef(candles);
  candlesRef.current = candles;

  useEffect(() => {
    const on = () => setTheme((t) => t + 1);
    window.addEventListener("sb-theme", on);
    const onFs = () => setFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => { window.removeEventListener("sb-theme", on); document.removeEventListener("fullscreenchange", onFs); };
  }, []);

  // Reset drawings that depend on bar times when resolution/feed changes.
  useEffect(() => { setTrends([]); pendingTrend.current = null; }, [res, feed]);

  const indKey = [...ind].sort().join(",");
  const subSecond = res.endsWith("s");

  /* ---------- build chart (on structural changes) ---------- */
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const text = cssVar("--muted", "#8a9690");
    const grid = cssVar("--chart-grid", "rgba(255,255,255,0.04)");
    const border = cssVar("--border", "rgba(255,255,255,0.07)");
    const up = cssVar("--up", "#19e07d");
    const down = cssVar("--down", "#ff4d5f");
    const brand = cssVar("--brand", "#00f53a");

    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: text, fontFamily: "Inter, ui-sans-serif, system-ui", fontSize: 11, panes: { separatorColor: border, separatorHoverColor: border }, attributionLogo: false },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { labelBackgroundColor: "#1d2622" }, horzLine: { labelBackgroundColor: "#1d2622" } },
      rightPriceScale: { borderColor: border, scaleMargins: { top: 0.08, bottom: ind.has("vol") ? 0.22 : 0.08 } },
      timeScale: { borderColor: border, timeVisible: true, secondsVisible: subSecond, rightOffset: 6, barSpacing: subSecond ? 7 : 8 },
      localization: { priceFormatter: (p: number) => formatPrice(p, { currency: false }) },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    chartRef.current = chart;
    const priceFormat = { type: "custom" as const, formatter: (p: number) => formatPrice(p, { currency: false }), minMove: 1e-12 };

    let main: ISeriesApi<SeriesType>;
    if (type === "candles") main = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false, priceFormat });
    else if (type === "line") main = chart.addSeries(LineSeries, { color: brand, lineWidth: 2, priceFormat });
    else main = chart.addSeries(AreaSeries, { lineColor: brand, topColor: `${brand}55`, bottomColor: `${brand}00`, lineWidth: 2, priceFormat });
    mainRef.current = main;
    const s: Record<string, ISeriesApi<SeriesType>> = {};
    if (ind.has("vol")) {
      s.vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }
    const overlay = (id: string, color: string, width: 1 | 2 = 1, style = LineStyle.Solid) =>
      (s[id] = chart.addSeries(LineSeries, { color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat }));
    if (ind.has("ma20")) overlay("ma20", COLORS.ma20);
    if (ind.has("ma50")) overlay("ma50", COLORS.ma50);
    if (ind.has("ema21")) overlay("ema21", COLORS.ema21);
    if (ind.has("bb")) { overlay("bbU", COLORS.bb, 1, LineStyle.Dashed); overlay("bbM", COLORS.bb, 1, LineStyle.Dotted); overlay("bbL", COLORS.bb, 1, LineStyle.Dashed); }
    if (ind.has("vwap")) overlay("vwap", COLORS.vwap, 2);

    let pane = 1;
    const paneSeries = (id: string, color: string, p: number) =>
      (s[id] = chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false }, p));
    if (ind.has("rsi")) {
      paneSeries("rsi", COLORS.rsi, pane);
      s.rsi.createPriceLine({ price: 70, color: down, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" });
      s.rsi.createPriceLine({ price: 30, color: up, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" });
      pane++;
    }
    if (ind.has("macd")) {
      s.macdH = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
      paneSeries("macd", COLORS.macd, pane);
      paneSeries("macdS", COLORS.signal, pane);
      pane++;
    }
    if (ind.has("bsr")) {
      paneSeries("bsr", COLORS.bsr, pane);
      s.bsr.createPriceLine({ price: 0.5, color: text, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: "" });
      pane++;
    }
    if (ind.has("mom")) {
      paneSeries("mom", COLORS.mom, pane);
      s.mom.createPriceLine({ price: 0, color: text, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: "" });
      pane++;
    }
    const panes = chart.panes();
    for (let i = 1; i < panes.length; i++) panes[i].setHeight(compact ? 70 : 96);
    seriesRef.current = s;
    markersRef.current = createSeriesMarkers(main, []);
    lastShape.current = null;
    priceLinesRef.current = [];
    trendSeriesRef.current = [];

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) { setLegend(null); return; }
      const c = candlesRef.current.find((x) => x.time === (param.time as number));
      setLegend(c ?? null);
    });
    chart.subscribeClick((param) => {
      if (!param.point || toolRef.current === "none") return;
      const price = main.coordinateToPrice(param.point.y);
      if (price === null) return;
      if (toolRef.current === "hline") { setHlines((h) => [...h, price as number]); setTool("none"); return; }
      const time = (param.time as number | undefined) ?? chart.timeScale().coordinateToTime(param.point.x) as number | null;
      if (!time) return;
      if (!pendingTrend.current) { pendingTrend.current = { t: time, p: price as number }; return; }
      const a = pendingTrend.current;
      pendingTrend.current = null;
      if (a.t === time) return;
      const [p1, p2] = a.t < time ? [a, { t: time, p: price as number }] : [{ t: time, p: price as number }, a];
      setTrends((tr) => [...tr, { t1: p1.t, p1: p1.p, t2: p2.t, p2: p2.p }]);
      setTool("none");
    });

    let vpTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleVp = () => { if (vpTimer) return; vpTimer = setTimeout(() => { vpTimer = null; computeVp(); }, 250); };
    const computeVp = () => {
      if (!ind.has("vp")) { setVp([]); return; }
      const range = chart.timeScale().getVisibleLogicalRange();
      const cs = candlesRef.current;
      if (!range || !cs.length) return;
      const vis = cs.slice(Math.max(0, Math.floor(range.from)), Math.min(cs.length, Math.ceil(range.to) + 1));
      const buckets = volumeProfile(vis, 28);
      const maxV = Math.max(...buckets.map((b) => b.volume), 1);
      setVp(buckets.map((b) => {
        const y1 = main.priceToCoordinate(b.priceHigh) ?? 0;
        const y2 = main.priceToCoordinate(b.priceLow) ?? 0;
        return { top: y1, h: Math.max(1, y2 - y1 - 1), w: b.volume / maxV, buy: b.volume ? b.buyVolume / b.volume : 0.5 };
      }));
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleVp);
    (chart as unknown as { __vp: () => void }).__vp = scheduleVp;

    return () => {
      if (vpTimer) clearTimeout(vpTimer);
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      markersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, indKey, theme, subSecond, feed.kind, compact]);

  /* ---------- push data ---------- */
  useEffect(() => {
    const chart = chartRef.current;
    const main = mainRef.current;
    if (!chart || !main) return;
    const s = seriesRef.current;
    const cs = candles;
    const shape = lastShape.current;
    const incremental = !!shape && cs.length > 0 && cs[0].time === shape.first && (cs.length === shape.len || cs.length === shape.len + 1) && cs[cs.length - 1].time >= shape.last;
    const up = cssVar("--up", "#19e07d");
    const down = cssVar("--down", "#ff4d5f");
    const mainPoint = (c: Candle) => (type === "candles" ? { time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close } : { time: ts(c.time), value: c.close });
    const volPoint = (c: Candle) => ({ time: ts(c.time), value: c.volume, color: c.close >= c.open ? `${up}55` : `${down}55` });

    const cl = closes(cs);
    const computed: Record<string, (number | null)[]> = {};
    if (s.ma20) computed.ma20 = sma(cl, 20);
    if (s.ma50) computed.ma50 = sma(cl, 50);
    if (s.ema21) computed.ema21 = ema(cl, 21);
    if (s.bbU) { const b = bollinger(cl); computed.bbU = b.upper; computed.bbM = b.mid; computed.bbL = b.lower; }
    if (s.vwap) computed.vwap = vwap(cs);
    if (s.rsi) computed.rsi = rsi(cl);
    if (s.macd) { const m = macd(cl); computed.macd = m.line; computed.macdS = m.signal; computed.macdH = m.hist; }
    if (s.bsr) computed.bsr = buyerSellerRatio(cs);
    if (s.mom) computed.mom = momentum(cl);

    try {
      if (incremental) {
        const from = Math.max(0, cs.length - 2);
        for (let i = from; i < cs.length; i++) {
          main.update(mainPoint(cs[i]) as never);
          s.vol?.update(volPoint(cs[i]) as never);
          for (const [k, arr] of Object.entries(computed)) {
            const v = arr[i];
            if (v === null || v === undefined) continue;
            if (k === "macdH") s.macdH.update({ time: ts(cs[i].time), value: v, color: v >= 0 ? `${up}88` : `${down}88` } as never);
            else s[k]?.update({ time: ts(cs[i].time), value: v } as never);
          }
        }
      } else {
        main.setData(cs.map(mainPoint) as never);
        s.vol?.setData(cs.map(volPoint) as never);
        for (const [k, arr] of Object.entries(computed)) {
          if (k === "macdH") s.macdH.setData(cs.map((c, i) => (arr[i] === null ? { time: ts(c.time) } : { time: ts(c.time), value: arr[i] as number, color: (arr[i] as number) >= 0 ? `${up}88` : `${down}88` })) as never);
          else s[k]?.setData(line(cs, arr) as never);
        }
        if (!shape && cs.length) chart.timeScale().scrollToRealTime();
      }
    } catch {
      // Out-of-order update (e.g. clock skew) — fall back to a full redraw next tick.
      lastShape.current = null;
      return;
    }
    lastShape.current = cs.length ? { len: cs.length, first: cs[0].time, last: cs[cs.length - 1].time } : null;
    (chart as unknown as { __vp?: () => void }).__vp?.();
  }, [candles, type, indKey, theme, subSecond]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- large-trade markers ---------- */
  useEffect(() => {
    const m = markersRef.current;
    if (!m) return;
    if (!ind.has("markers") || !trades.length || !candles.length) { m.setMarkers([]); return; }
    const sec = res.endsWith("s") ? Number(res.slice(0, -1)) : res.endsWith("m") ? Number(res.slice(0, -1)) * 60 : res.endsWith("h") ? Number(res.slice(0, -1)) * 3600 : res === "1d" ? 86400 : 604800;
    const thr = largeTradeThreshold(trades, feed.kind === "binance" ? 50_000 : 2_500);
    const first = candles[0].time;
    const last = candles[candles.length - 1].time;
    const markers: SeriesMarker<Time>[] = trades
      .filter((t) => t.notional >= thr)
      .map((t) => ({ t, bar: Math.floor(t.time / 1000 / sec) * sec }))
      .filter(({ bar }) => bar >= first && bar <= last)
      .slice(0, 60)
      .sort((a, b) => a.bar - b.bar)
      .map(({ t, bar }) => ({
        time: ts(bar), position: t.side === "buy" ? "belowBar" : "aboveBar", shape: t.side === "buy" ? "arrowUp" : "arrowDown",
        color: t.side === "buy" ? cssVar("--up", "#19e07d") : cssVar("--down", "#ff4d5f"), text: formatUsd(t.notional, 1), size: 1,
      }));
    m.setMarkers(markers);
  }, [trades, candles, ind, res, feed.kind, theme, indKey]);

  /* ---------- drawings ---------- */
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    priceLinesRef.current.forEach((pl) => { try { main.removePriceLine(pl); } catch { /* ignore */ } });
    priceLinesRef.current = hlines.map((p) => main.createPriceLine({ price: p, color: cssVar("--warn", "#f5b83d"), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" }));
  }, [hlines, type, indKey, theme, subSecond]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    trendSeriesRef.current.forEach((sr) => { try { chart.removeSeries(sr); } catch { /* ignore */ } });
    trendSeriesRef.current = trends.map((t) => {
      const sr = chart.addSeries(LineSeries, { color: cssVar("--warn", "#f5b83d"), lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      sr.setData([{ time: ts(t.t1), value: t.p1 }, { time: ts(t.t2), value: t.p2 }]);
      return sr;
    });
  }, [trends, type, indKey, theme, subSecond]);

  const toggleInd = useCallback((id: IndicatorId) => setPrefs((p) => ({ ...p, ind: p.ind.includes(id) ? p.ind.filter((x) => x !== id) : [...p.ind, id] })), [setPrefs]);
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrapRef.current?.requestFullscreen?.().catch(() => {});
  };

  const shown = legend ?? candles[candles.length - 1] ?? null;
  const prev = shown ? candles[candles.findIndex((c) => c.time === shown.time) - 1] : undefined;
  const chg = shown && prev ? ((shown.close - prev.close) / prev.close) * 100 : null;
  const volUsd = feed.kind === "dex";

  return (
    <div ref={wrapRef} className={clsx("panel flex flex-col overflow-hidden bg-surface", full && "rounded-none", className)}>
      {/* toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-line overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-0.5" role="group" aria-label="Timeframe">
          {resList.map((r) => (
            <button key={r} onClick={() => setRes(r)} aria-pressed={res === r} className={clsx("px-2 h-7 rounded-md text-xs font-semibold num", res === r ? "bg-brand-soft text-brand" : "text-muted hover:text-fg hover:bg-surface-2")}>{r}</button>
          ))}
        </div>
        <span className="w-px h-5 bg-line mx-1 shrink-0" />
        <div className="flex items-center gap-0.5" role="group" aria-label="Chart type">
          {(["candles", "line", "area"] as ChartType[]).map((t) => {
            const Icon = t === "candles" ? CandlestickChart : t === "line" ? LineChart : AreaChart;
            return <button key={t} title={t} aria-label={`${t} chart`} aria-pressed={type === t} onClick={() => setPrefs((p) => ({ ...p, type: t }))} className={clsx("h-7 w-7 grid place-items-center rounded-md", type === t ? "bg-surface-3 text-fg" : "text-muted hover:text-fg")}><Icon size={15} /></button>;
          })}
        </div>
        <span className="w-px h-5 bg-line mx-1 shrink-0" />
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} aria-expanded={menu} className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-muted hover:text-fg hover:bg-surface-2"><Activity size={14} /> Indicators{ind.size ? <span className="text-brand num">{ind.size}</span> : null}</button>
        </div>
        <span className="w-px h-5 bg-line mx-1 shrink-0" />
        <div className="flex items-center gap-0.5" role="group" aria-label="Drawing tools">
          <button title="Pointer" aria-label="Pointer" onClick={() => setTool("none")} className={clsx("h-7 w-7 grid place-items-center rounded-md", tool === "none" ? "text-fg" : "text-muted hover:text-fg")}><MousePointer2 size={14} /></button>
          <button title="Horizontal line (click chart)" aria-label="Horizontal line" onClick={() => setTool(tool === "hline" ? "none" : "hline")} className={clsx("h-7 w-7 grid place-items-center rounded-md", tool === "hline" ? "bg-warn/15 text-warn" : "text-muted hover:text-fg")}><Minus size={15} /></button>
          <button title="Trend line (click two points)" aria-label="Trend line" onClick={() => { pendingTrend.current = null; setTool(tool === "trend" ? "none" : "trend"); }} className={clsx("h-7 w-7 grid place-items-center rounded-md", tool === "trend" ? "bg-warn/15 text-warn" : "text-muted hover:text-fg")}><TrendingUp size={15} /></button>
          {(hlines.length > 0 || trends.length > 0) && <button title="Clear drawings" aria-label="Clear drawings" onClick={() => { setHlines([]); setTrends([]); }} className="h-7 w-7 grid place-items-center rounded-md text-muted hover:text-down"><Trash2 size={14} /></button>}
        </div>
        <div className="flex-1" />
        <button onClick={toggleFull} aria-label="Fullscreen" className="h-7 w-7 grid place-items-center rounded-md text-muted hover:text-fg shrink-0">{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
      </div>

      {menu && (
        <div className="border-b border-line px-3 py-2.5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs bg-surface-2/60">
          {["Overlays", "Oscillators", "ShareBajar"].map((g) => (
            <div key={g} className="contents">
              {INDICATORS.filter((i) => i.group === g).map((i) => {
                return (
                  <label key={i.id} title={i.hint} className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input type="checkbox" className="accent-[var(--brand)]" checked={ind.has(i.id)} onChange={() => toggleInd(i.id)} />
                    <span>{i.label}</span>{g === "ShareBajar" && <span className="text-[9px] text-brand font-bold">SB</span>}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* chart */}
      <div className={clsx("relative", full ? "flex-1 min-h-0" : "shrink-0")} style={full ? undefined : { height }}>
        <div ref={elRef} className={clsx("absolute inset-0", tool !== "none" && "cursor-crosshair")} />
        <div className="pointer-events-none absolute left-3 top-2 z-10 text-[11px] num flex flex-wrap gap-x-3 gap-y-0.5 max-w-[calc(100%-80px)]">
          {label && <span className="font-semibold text-fg text-xs">{label} · {res}</span>}
          {shown && (type === "candles" ? (
            <>
              <span className="text-muted">O <span className="text-fg">{formatPrice(shown.open, { currency: false })}</span></span>
              <span className="text-muted">H <span className="text-fg">{formatPrice(shown.high, { currency: false })}</span></span>
              <span className="text-muted">L <span className="text-fg">{formatPrice(shown.low, { currency: false })}</span></span>
              <span className="text-muted">C <span className="text-fg">{formatPrice(shown.close, { currency: false })}</span></span>
            </>
          ) : <span className="text-fg">{formatPrice(shown.close)}</span>)}
          {chg !== null && <span className={chg >= 0 ? "text-up" : "text-down"}>{formatPct(chg)}</span>}
          {shown && shown.volume > 0 && <span className="text-muted">Vol <span className="text-fg">{volUsd ? formatUsd(shown.volume) : formatNumber(shown.volume)}</span></span>}
          {tool !== "none" && <span className="text-warn">{tool === "hline" ? "Click to place a horizontal line" : pendingTrend.current ? "Click the second point" : "Click the first point"}</span>}
        </div>
        {ind.has("vp") && vp.length > 0 && (
          <div className="pointer-events-none absolute inset-y-0 right-[64px] w-[22%] max-w-[180px] z-[5]">
            {vp.map((b, i) => (
              <div key={i} className="absolute right-0 flex justify-end" style={{ top: b.top, height: b.h, width: `${Math.max(2, b.w * 100)}%` }}>
                <div className="h-full" style={{ width: `${b.buy * 100}%`, background: "color-mix(in srgb, var(--up) 22%, transparent)" }} />
                <div className="h-full flex-1" style={{ background: "color-mix(in srgb, var(--down) 22%, transparent)" }} />
              </div>
            ))}
          </div>
        )}
        {feedState.loading && !candles.length && <div className="absolute inset-0 grid place-items-center text-xs text-muted">Loading market data…</div>}
        {!feedState.loading && !candles.length && (
          <div className="absolute inset-0 grid place-items-center text-center text-xs text-muted px-6">
            {feedState.error ? <span className="text-down">{feedState.error}</span> : feed.kind === "dex" && subSecond ? "Waiting for on-chain trades — sub-minute candles are built only from real swaps." : "No data for this timeframe."}
          </div>
        )}
      </div>

      {/* status bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-line text-[11px] text-muted overflow-x-auto no-scrollbar">
        <DataStatus
          fetchedAt={feedState.lastUpdate}
          expectedMs={feedState.expectedMs}
          error={feedState.error}
          source={feedState.source}
          liveLabel={feedState.mode === "stream" ? "Live stream" : "Live (polled 4s)"}
        />
        {feedState.lastUpdate && <span className="num whitespace-nowrap">Updated {formatTime(feedState.lastUpdate)}</span>}
        {feed.kind === "dex" && subSecond && feedState.coverageFrom && <span className="whitespace-nowrap">Candles built from swaps since {formatTime(feedState.coverageFrom)}</span>}
        {feedState.error && candles.length > 0 && <span className="text-warn whitespace-nowrap">{feedState.error}</span>}
      </div>
    </div>
  );
}
