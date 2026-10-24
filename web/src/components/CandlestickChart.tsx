"use client";

import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart, type CandlestickData, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../lib/market-activity";

const formatPrice = (value: number) => new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 }).format(value);

/** TradingView owns rendering and interactions; only confirmed OHLC is supplied. */
export function CandlestickChart({ candles, interval, symbol, quote }: { candles: Candle[]; interval: number; symbol: string; quote: string }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const priceSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeries = useRef<ISeriesApi<"Histogram"> | null>(null);
  const previous = useRef<{ interval: number; candles: Candle[] }>({ interval, candles: [] });
  const [hovered, setHovered] = useState<Candle | null>(null);
  const candlesRef = useRef(candles);
  candlesRef.current = candles;

  useEffect(() => {
    if (!container.current) return;
    const api = createChart(container.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#626b79", fontFamily: "Segoe UI, sans-serif", fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: "#edf0f4" }, horzLines: { color: "#edf0f4" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#8a94a3", labelBackgroundColor: "#202630" }, horzLine: { color: "#8a94a3", labelBackgroundColor: "#202630" } },
      rightPriceScale: { borderColor: "#e7e9ed", scaleMargins: { top: .1, bottom: .25 }, minimumWidth: 72 },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#e7e9ed", rightOffset: 6, barSpacing: 9, minBarSpacing: 3, fixLeftEdge: true },
      localization: { locale: "en-US", priceFormatter: formatPrice },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    const prices = api.addSeries(CandlestickSeries, {
      upColor: "#14764b", downColor: "#b93249", wickUpColor: "#14764b", wickDownColor: "#b93249", borderVisible: false,
      priceLineColor: "#2458bc", priceFormat: { type: "custom", formatter: formatPrice, minMove: .00000001 },
    });
    const volumes = api.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false });
    volumes.priceScale().applyOptions({ scaleMargins: { top: .82, bottom: 0 }, visible: false });
    api.subscribeCrosshairMove(event => {
      if (typeof event.time !== "number") { setHovered(null); return; }
      setHovered(candlesRef.current.find(candle => candle.time === event.time) ?? null);
    });
    chart.current = api;
    priceSeries.current = prices;
    volumeSeries.current = volumes;
    return () => { api.remove(); chart.current = null; priceSeries.current = null; volumeSeries.current = null; previous.current = { interval: 0, candles: [] }; };
  }, []);

  useEffect(() => {
    const api = chart.current, prices = priceSeries.current, volumes = volumeSeries.current;
    if (!api || !prices || !volumes) return;
    const old = previous.current;
    const sameInterval = old.interval === interval;
    const volume = (candle: Candle) => ({ time: candle.time as UTCTimestamp, value: candle.volume, color: candle.close >= candle.open ? "#14764b48" : "#b9324948" });
    const price = (candle: Candle): CandlestickData => ({ time: candle.time as UTCTimestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
    const appendOnly = sameInterval && old.candles.length > 0 && candles.length >= old.candles.length
      && old.candles.slice(0, -1).every((candle, index) => { const next = candles[index]; return candle.time === next.time && candle.open === next.open && candle.high === next.high && candle.low === next.low && candle.close === next.close && candle.volume === next.volume; })
      && candles[old.candles.length - 1]?.time === old.candles.at(-1)?.time;
    if (appendOnly) {
      for (const candle of candles.slice(old.candles.length - 1)) { prices.update(price(candle)); volumes.update(volume(candle)); }
    } else {
      const range = api.timeScale().getVisibleLogicalRange();
      prices.setData(candles.map(price));
      volumes.setData(candles.map(volume));
      if (sameInterval && old.candles.length && range) api.timeScale().setVisibleLogicalRange(range);
      else if (candles.length) api.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 75), to: Math.max(35, candles.length + 6) });
    }
    previous.current = { interval, candles };
    setHovered(null);
  }, [candles, interval]);

  const selected = hovered ?? candles.at(-1);
  return <div className="sb-tv-chart">
    <div className="sb-chart-ohlc" aria-live="off"><strong>{symbol}</strong>{selected && <><span>O <b>{formatPrice(selected.open)}</b></span><span>H <b>{formatPrice(selected.high)}</b></span><span>L <b>{formatPrice(selected.low)}</b></span><span className={selected.close >= selected.open ? "sb-positive" : "sb-negative"}>C <b>{formatPrice(selected.close)}</b></span><span>Vol <b>{formatPrice(selected.volume)}</b></span></>}</div>
    <div ref={container} className="sb-lightweight-chart" role="img" aria-label={`${symbol} TradingView candlestick chart in ${quote}, ${interval / 60} minute intervals`} />
    <div className="sb-chart-controls"><div><button type="button" onClick={() => chart.current?.timeScale().scrollToRealTime()}>Live</button><button type="button" onClick={() => chart.current?.timeScale().fitContent()}>Fit chart</button></div><span>UTC · Volume in {quote} · <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView</a></span></div>
  </div>;
}
