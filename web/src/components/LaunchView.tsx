"use client";

import { useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Gift, Globe, ImagePlus, Info, Layers3, LockKeyhole, Rocket, ShieldCheck, X } from "lucide-react";
import { formatUnits } from "viem";
import type { ViewContext } from "./StockBackApp";
import { Amount, Button, atomic } from "./ui";
import { devBuyForPercent, encodeMetadata, launchOutput, MEME_SUPPLY } from "../lib/launch";

export function LaunchView({ data, actions, ready, busy, run, navigate }: ViewContext) {
  const id = useId();
  const uploadSequence = useRef(0);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [feeBps, setFeeBps] = useState<100 | 300>(100);
  const [liquidity, setLiquidity] = useState("1000");
  const [devMode, setDevMode] = useState<"percent" | "amount">("percent");
  const [devPercent, setDevPercent] = useState(0);
  const [devAmount, setDevAmount] = useState("0");
  const [image, setImage] = useState<string>();
  const [imageName, setImageName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string>();
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submittedHash, setSubmittedHash] = useState<string>();
  const [error, setError] = useState<string>();
  const [category, setCategory] = useState("All assets");
  const asset = data.stockToken;
  const locked = busy || uploading;
  const walletConnected = data.wallet.status === "connected";
  const balanceReady = ready && data.wallet.balancesStatus === "ready";
  const initial = atomic(liquidity, 18) ?? 0n;
  let buyAmount = devAmount;
  if (devMode === "percent") {
    try { buyAmount = devBuyForPercent(liquidity, devPercent, feeBps); } catch { buyAmount = "0"; }
  }
  const buy = atomic(buyAmount, 18);
  const output = launchOutput(initial, buy ?? 0n, feeBps);
  const supplyPercent = Number((output * 10000n + MEME_SUPPLY / 2n) / MEME_SUPPLY) / 100;
  const devValid = buy !== null && output <= MEME_SUPPLY * 75n / 100n && (buy === 0n || output > 0n);
  const total = initial + (buy ?? 0n);
  const available = data.wallet.stockBalance === null ? null : atomic(data.wallet.stockBalance, 18);
  const sufficient = balanceReady && available !== null && total > 0n && available >= total;
  let linksError: string | undefined;
  try { encodeMetadata({ image, website, twitter, telegram }); }
  catch (error) { linksError = error instanceof Error ? error.message : "Check your project links."; }
  const valid = Boolean(name.trim() && name.length <= 48 && new TextEncoder().encode(name.trim()).length <= 128 && /^[A-Z0-9]{1,12}$/.test(symbol) && initial > 0n && devValid && !linksError && !imageError && sufficient);
  const launchSuccess = submitted && data.transaction.status === "success" && data.transaction.label === "Create coin" && data.transaction.hash !== submittedHash;
  const categories = ["All assets", "Stocks", "Commodities", "Private companies"];
  const assets = (data.quoteAssets ?? [asset]).filter(token => category === "All assets" || (category === "Commodities" ? token.symbol === "GLDX" : category === "Private companies" ? token.symbol === "ANTHROPIC" : token.symbol !== "GLDX" && token.symbol !== "ANTHROPIC"));

  async function chooseImage(file?: File) {
    const sequence = ++uploadSequence.current;
    setImageError(undefined);
    if (!file) return;
    setImage(undefined); setImageName(""); setUploading(true);
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error("Choose a PNG, JPEG or WebP, up to 2 MB.");
      const bitmap = await createImageBitmap(file);
      if (bitmap.width !== bitmap.height || bitmap.width < 32 || bitmap.width > 8192) { bitmap.close(); throw new Error("Choose square artwork between 32 and 8192 pixels."); }
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext("2d");
      if (!ctx) { bitmap.close(); throw new Error("Image processing is unavailable in this browser."); }
      ctx.drawImage(bitmap, 0, 0, 128, 128); bitmap.close();
      let result = canvas.toDataURL("image/webp", 0.75);
      if (result.length > 12_500) result = canvas.toDataURL("image/webp", 0.4);
      if (result.length > 12_500) { canvas.width = canvas.height = 64; const smaller = await createImageBitmap(file); ctx.drawImage(smaller, 0, 0, 64, 64); smaller.close(); result = canvas.toDataURL("image/webp", 0.5); }
      if (result.length > 12_500) throw new Error("This image is too detailed. Try simpler square artwork.");
      if (sequence === uploadSequence.current) { setImage(result); setImageName(file.name); }
    } catch (error) { if (sequence === uploadSequence.current) setImageError(error instanceof Error ? error.message : "This image could not be opened."); }
    finally { if (sequence === uploadSequence.current) setUploading(false); }
  }

  function perform(operation: () => ReturnType<typeof actions.connectWallet>) {
    run(async () => { setError(undefined); try { await operation(); } catch (error) { setError(error instanceof Error ? error.message : "Please try again."); throw error; } });
  }

  return <div className="sb-launch-page">
    <button type="button" className="sb-launch-back" disabled={locked} onClick={() => navigate("launchpad")}><ArrowLeft size={15} />Back to discover</button>
    <div className="sb-launch-title"><span className="sb-eyebrow"><Rocket size={14} />YOUR IDEA. YOUR MARKET.</span><h1>Launch a token</h1><p>Create a fixed-supply meme token, choose its quote asset, and share trading fees with your community.</p></div>
    <form className="sb-launch-layout" onSubmit={event => {
      event.preventDefault();
      if (!ready || !valid || locked || data.launchAvailable === false) return;
      setSubmitted(true); setSubmittedHash(data.transaction.hash);
      perform(() => actions.createCoin({ name: name.trim(), symbol, stockTokenId: asset.id, initialStockLiquidity: liquidity, devBuyAmount: buyAmount, tradingFeeBps: feeBps, metadata: { image, website, twitter, telegram } }));
    }}>
      <div className="sb-launch-fields">
        <section className="sb-launch-section">
          <label>Launch on</label><div className="sb-launch-platform"><Layers3 size={18} /><strong>StockBack</strong><span>Monad Testnet</span></div>
          <label>Fee model</label><div className="sb-launch-model"><Gift size={18} /><strong>Reward token</strong><CheckCircle2 size={17} /></div>
          <label>Trading fee</label><div className="sb-launch-segment sb-launch-fee-options" role="group" aria-label="Trading fee">{([100, 300] as const).map(rate => <button type="button" key={rate} aria-pressed={feeBps === rate} disabled={locked} onClick={() => setFeeBps(rate)}>{rate / 100}%</button>)}</div>
          <div className="sb-launch-reward"><div><span>Trading fee</span><strong>{feeBps / 100}%</strong></div><div><span>Holder share of fees</span><strong>40%</strong></div><div><span>Transfer tax</span><strong>0%</strong></div></div>
          <p className="sb-launch-note"><Info size={16} /><span>Every trade rewards your community in {asset.symbol}. Trading fees are split between holders (40%), StockVault (10%) and treasury (50%). The creator earns holder rewards under the same rules as everyone else.</span></p>
        </section>

        <section className="sb-launch-section">
          <div className="sb-launch-section-heading"><h2>Dev buy <span className="sb-launch-optional">Optional</span></h2><div className="sb-launch-segment" role="group" aria-label="Dev buy input mode"><button type="button" aria-pressed={devMode === "percent"} disabled={locked} onClick={() => { setDevMode("percent"); setDevPercent(Math.min(75, Math.floor(supplyPercent))); }}>% of supply</button><button type="button" aria-pressed={devMode === "amount"} disabled={locked} onClick={() => { setDevAmount(buyAmount); setDevMode("amount"); }}>{asset.symbol} amount</button></div></div>
          <p>Make the market’s first buy in the same launch transaction. Purchase up to 75% of the supply; your tokens go directly to your wallet.</p>
          {devMode === "percent" ? <><label className="sb-sr-only" htmlFor={`${id}-percent`}>Dev buy percentage</label><input id={`${id}-percent`} className="sb-launch-slider" type="range" min="0" max="75" step="1" value={devPercent} disabled={locked} onChange={event => setDevPercent(Number(event.target.value))} /><div className="sb-launch-range-labels"><span>0%</span><strong>{devPercent}% of supply</strong><span>75%</span></div></> : <div className="sb-field"><label htmlFor={`${id}-buy`}>Dev buy amount</label><div className="sb-input-with-unit"><input id={`${id}-buy`} inputMode="decimal" value={devAmount} disabled={locked} onChange={event => setDevAmount(event.target.value)} /><span>{asset.symbol}</span></div></div>}
          <div className="sb-launch-buy-estimate"><span>Estimated receive</span><strong><Amount value={formatUnits(output, 18)} digits={2} /> {symbol || "TOKEN"}</strong><small><Amount value={buyAmount} digits={6} /> {asset.symbol} · {feeBps / 100}% trading fee included</small></div>
          {!devValid && <p role="alert" className="sb-negative">Enter a valid amount buying at most 75% of the supply.</p>}
        </section>

        <section className="sb-launch-section">
          <div className="sb-launch-two">
            <div className="sb-field"><label htmlFor={`${id}-name`}>Token name</label><input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} maxLength={48} placeholder="e.g. NVIDIA Cat" required disabled={locked} /><small>Maximum 48 characters</small></div>
            <div className="sb-field"><label htmlFor={`${id}-symbol`}>Symbol</label><input id={`${id}-symbol`} value={symbol} onChange={event => setSymbol(event.target.value.toUpperCase())} maxLength={12} pattern="[A-Z0-9]{1,12}" placeholder="e.g. NCAT" required disabled={locked} /><small>1–12 letters or numbers</small></div>
          </div>
          <div className="sb-field sb-launch-image-field"><label htmlFor={`${id}-image`}>Token image <span className="sb-launch-optional">Optional</span></label><label className={`sb-launch-upload ${image ? "has-image" : ""}`} htmlFor={`${id}-image`}>
            {image ? <img src={image} alt="Token artwork preview" width={64} height={64} /> : <span className="sb-launch-upload-icon"><ImagePlus size={24} /></span>}<span><strong>{uploading ? "Preparing artwork…" : imageName || "Choose a PNG, JPEG or WebP"}</strong><small>Square artwork, up to 2 MB · Optimized for your token</small></span><input id={`${id}-image`} type="file" accept="image/png,image/jpeg,image/webp" disabled={locked} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void chooseImage(file); }} /></label>
            {image && <small>Artwork is saved permanently. Larger images increase network gas.</small>}
            {image && <button type="button" className="sb-launch-remove" disabled={locked} onClick={() => { uploadSequence.current++; setImage(undefined); setImageName(""); }}><X size={13} />Remove image</button>}
            {imageError && <p role="alert" className="sb-negative">{imageError}</p>}
          </div>
        </section>

        <section className="sb-launch-section"><h2>Project links <span className="sb-launch-optional">Optional</span></h2><p>Give your community a place to find you. Links and artwork are saved permanently with your launch.</p>
          <div className="sb-field"><label htmlFor={`${id}-website`}>Website</label><input id={`${id}-website`} type="url" value={website} onChange={event => setWebsite(event.target.value)} maxLength={256} placeholder="https://your-project.com" disabled={locked} /></div>
          <div className="sb-launch-two"><div className="sb-field"><label htmlFor={`${id}-twitter`}>X / Twitter</label><input id={`${id}-twitter`} type="url" value={twitter} onChange={event => setTwitter(event.target.value)} maxLength={256} placeholder="https://x.com/project" disabled={locked} /></div><div className="sb-field"><label htmlFor={`${id}-telegram`}>Telegram</label><input id={`${id}-telegram`} type="url" value={telegram} onChange={event => setTelegram(event.target.value)} maxLength={256} placeholder="https://t.me/project" disabled={locked} /></div></div>
          {linksError && <p role="alert" className="sb-negative">{linksError}</p>}
        </section>

        <section className="sb-launch-section"><h2>Quote token</h2><p>Your token will trade against this asset. Fees and rewards are paid in the same token.</p>
          <div className="sb-launch-categories" role="group" aria-label="Quote asset category">{categories.map(item => <button type="button" key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
          <div className="sb-launch-asset-grid" role="group" aria-label="Launch quote asset">{assets.map(token => <button type="button" key={token.id} aria-pressed={token.id.toLowerCase() === asset.id.toLowerCase()} disabled={locked} onClick={() => { setError(undefined); perform(() => actions.selectQuoteAsset?.(token.id)); }}><span className={`sb-launch-asset-icon sb-launch-asset-icon--${token.symbol.toLowerCase()}`}>{token.symbol === "GLDX" ? <Layers3 size={21} /> : token.symbol === "ANTHROPIC" ? "AI" : token.symbol.slice(0, 2)}</span><span><strong>{token.symbol}</strong><small>{token.name.replace(/^Mock /, "")}</small></span>{token.id.toLowerCase() === asset.id.toLowerCase() && <Check size={15} />}</button>)}</div>
          <small className="sb-launch-demo-note">Demo assets on Monad Testnet. No real asset backing or issuer affiliation.</small>
        </section>

        <section className="sb-launch-section"><h2>Initial liquidity</h2><p>Seed your market with {asset.symbol}. This liquidity is permanently locked.</p><div className="sb-field"><label htmlFor={`${id}-liquidity`}>Initial stock liquidity</label><div className="sb-input-with-unit"><input id={`${id}-liquidity`} inputMode="decimal" value={liquidity} required disabled={locked} onChange={event => setLiquidity(event.target.value)} /><span>{asset.symbol}</span></div><small>Available: <Amount value={balanceReady ? data.wallet.stockBalance : null} /> {asset.symbol}</small></div>
          {ready && !sufficient && balanceReady && <p className="sb-negative">Insufficient {asset.symbol} balance for liquidity and dev buy.</p>}
          {ready && data.wallet.faucetAvailable && <Button type="button" variant="secondary" disabled={locked} onClick={() => perform(actions.requestFaucet)}>Get test {asset.symbol}<ArrowRight size={14} /></Button>}
        </section>
      </div>

      <aside className="sb-launch-aside" aria-label="Launch summary">
        <div className="sb-launch-summary-title"><h2>Launch summary</h2><span className="sb-badge">REWARD</span></div>
        <div className="sb-launch-token-preview">{image ? <img src={image} alt="" width={44} height={44} /> : <span><Rocket size={22} /></span>}<div><strong>{name.trim() || "Your next big idea"}</strong><small>{symbol || "TOKEN"} / {asset.symbol}</small></div></div>
        <dl className="sb-launch-summary-rows"><div><dt>Launchpad</dt><dd>StockBack</dd></div><div><dt>Fee model</dt><dd>Reward token</dd></div><div><dt>Network</dt><dd>Monad Testnet</dd></div><div><dt>Supply</dt><dd>1 million</dd></div><div><dt>Trading fee</dt><dd>{feeBps / 100}%</dd></div><div><dt>Holder share of fees</dt><dd className="sb-accent">40%</dd></div><div><dt>Transfer tax</dt><dd>None</dd></div><div><dt>Quote asset</dt><dd>{asset.symbol}</dd></div><div><dt>Initial liquidity</dt><dd><Amount value={liquidity} /> {asset.symbol}</dd></div><div><dt>Dev buy</dt><dd>{supplyPercent}% of supply</dd></div><div className="sb-launch-total"><dt>Total quote tokens</dt><dd><Amount value={formatUnits(total, 18)} /> {asset.symbol}</dd></div><div><dt>Network fee</dt><dd>Shown in wallet · MON</dd></div></dl>
        <div className="sb-launch-guarantees"><p><LockKeyhole size={16} /><span>Liquidity is permanently locked. No additional supply can be minted.</span></p><p><Globe size={16} /><span>Artwork and project links are saved with your launch and cannot be changed.</span></p><p><ShieldCheck size={16} /><span>No separate platform launch fee. Network gas is paid in test MON.</span></p></div>
        <div className="sb-launch-submit">
          {!walletConnected ? <Button type="button" className="sb-full" disabled={locked} onClick={() => perform(actions.connectWallet)}>Connect wallet<ArrowRight size={16} /></Button> : !ready ? <Button type="button" className="sb-full" disabled={locked} onClick={() => perform(actions.switchNetwork)}>Switch to Monad Testnet</Button> : <Button type="submit" className="sb-full" disabled={!valid || locked || data.launchAvailable === false} busy={busy}>Launch token<Rocket size={16} /></Button>}
          {data.launchAvailable === false && <p role="status">Launch contracts are not configured for this network.</p>}
          {ready && data.wallet.balancesStatus === "loading" && <p role="status">Loading {asset.symbol} balance…</p>}
          {ready && data.wallet.balancesStatus === "error" && <p role="alert" className="sb-negative">Balance unavailable. {data.wallet.balancesError ?? "Retry when the network recovers."}</p>}
          {(error || data.transaction.status === "error") && <p role="alert" className="sb-negative">{error ?? data.transaction.message}</p>}
          {busy && <p role="status">{data.transaction.label ?? "Waiting for wallet confirmation…"}</p>}
          {launchSuccess ? <div className="sb-launch-confirmed" role="status"><CheckCircle2 size={18} /><strong>Your token is live.</strong><Button type="button" variant="ghost" onClick={() => navigate("launchpad")}>Explore your market<ArrowRight size={14} /></Button></div> : <small>Review your pair and amounts before confirming. Approval and launch require wallet confirmation.</small>}
        </div>
      </aside>
    </form>
  </div>;
}
