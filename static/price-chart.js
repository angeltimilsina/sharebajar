import {preparePriceHistory,pricePrecision} from './chart-data.js';

const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const charts=new Map();
const theme=()=>{const style=getComputedStyle(document.documentElement);return {background:style.getPropertyValue('--chart-bg').trim()||'#10171f',text:style.getPropertyValue('--chart-text').trim()||'#91a0b2',grid:style.getPropertyValue('--chart-grid').trim()||'#1d2835'}};
let engine;
const loadEngine=()=>engine??=import('./vendor/lightweight-charts.mjs');

export function chartMarkup(id, {symbol='',currency=''}={}) {
  return `<section class="price-chart-panel" id="${escape(id)}" aria-label="${escape(symbol)} price history">
    <div class="price-chart-toolbar"><div class="chart-series-controls" role="group" aria-label="Chart style"><button type="button" data-chart-style="area" aria-pressed="true">Area</button><button type="button" data-chart-style="line" aria-pressed="false">Line</button></div><span class="chart-currency">${escape(currency || 'PRICE')}</span><div class="chart-zoom-controls" role="group" aria-label="Chart view"><button type="button" data-chart-action="zoom-in" aria-label="Zoom in">+</button><button type="button" data-chart-action="zoom-out" aria-label="Zoom out">−</button><button type="button" data-chart-action="fit">Reset view</button></div></div>
    <div class="chart-readout"><span class="chart-symbol">${escape(symbol)}</span><strong data-chart-price>—</strong><span data-chart-time>Loading chart…</span></div>
    <div class="price-chart-canvas" data-chart-canvas tabindex="0" role="img" aria-label="Interactive historical price chart. Drag to pan, pinch or scroll to zoom. Use the zoom buttons and Reset view for keyboard controls."><div class="loading">Preparing price chart</div></div>
    <div class="price-chart-footer"><span data-chart-summary>Historical observations · UTC</span><a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" title="TradingView Lightweight Charts™">© 2025 TradingView, Inc.</a></div>
  </section>`;
}

export function disposePriceCharts(root) {
  for(const [element,dispose] of charts) if(!root || root===element || root.contains(element)) {dispose();charts.delete(element);}
}

export async function mountPriceChart(element, {history,price,previousClose,currency,symbol,color='#16a34a',period='1d'}={}) {
  if(!element) return;
  const data=preparePriceHistory(history);
  const canvas=element.querySelector('[data-chart-canvas]');
  const controls=element.querySelectorAll('button');
  if(data.length<2) {
    canvas.innerHTML='<div class="empty">Historical chart unavailable from provider.</div>';
    element.querySelector('[data-chart-time]').textContent='Insufficient price history';
    controls.forEach(b=>b.disabled=true);
    return;
  }
  const token={cancelled:false};
  charts.get(element)?.();
  charts.set(element,()=>{token.cancelled=true;});
  try {
    const lib=await loadEngine();
    if(token.cancelled || !element.isConnected) {if(!token.cancelled)charts.delete(element);return;}
    canvas.replaceChildren();
    const precision=pricePrecision([...data.map(p=>p.value),price]);
    const number=new Intl.NumberFormat('en-US',{minimumFractionDigits:precision,maximumFractionDigits:precision});
    const format=v=>number.format(v)+(currency?' '+currency:'');
    const date=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    const chart=lib.createChart(canvas,{
      autoSize:true,
      layout:{background:{type:lib.ColorType.Solid,color:theme().background},textColor:theme().text,fontFamily:'Inter, system-ui, sans-serif',fontSize:11,attributionLogo:true},
      grid:{vertLines:{color:theme().grid},horzLines:{color:theme().grid}},
      rightPriceScale:{visible:true,borderColor:theme().grid,minimumWidth:76,scaleMargins:{top:.15,bottom:.15}},
      leftPriceScale:{visible:false},
      timeScale:{borderColor:theme().grid,timeVisible:['1h','1d','5d','7d'].includes(period),secondsVisible:false,rightOffset:8,minBarSpacing:.1},
      crosshair:{mode:lib.CrosshairMode.Magnet,vertLine:{color:'#60738a',labelBackgroundColor:'#34465c',style:lib.LineStyle.Dashed},horzLine:{color:'#60738a',labelBackgroundColor:'#34465c',style:lib.LineStyle.Dashed}},
      localization:{locale:'en-US',priceFormatter:v=>number.format(v),timeFormatter:t=>date.format(new Date(t*1000))+' UTC'},
      handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
      handleScale:{axisPressedMouseMove:true,mouseWheel:true,pinch:true},
      kineticScroll:{touch:true,mouse:false},
    });
    let series,frame=0,pending,click;
    charts.set(element,()=>{token.cancelled=true;cancelAnimationFrame(frame);if(click)element.removeEventListener('click',click);chart.remove();});
    const readout=element.querySelector('[data-chart-price]'),timestamp=element.querySelector('[data-chart-time]');
    const latest=data.at(-1);
    const showPoint=(point,hover=false)=>{
      readout.textContent=format(point.value);
      timestamp.textContent=(hover?'':'Last observation · ')+date.format(new Date(point.time*1000))+' UTC';
    };
    const setStyle=style=>{
      const range=chart.timeScale().getVisibleLogicalRange();
      if(series)chart.removeSeries(series);
      series=chart.addSeries(style==='line'?lib.LineSeries:lib.AreaSeries,{
        color,lineColor:color,topColor:color+'35',bottomColor:color+'02',lineWidth:2,
        priceLineVisible:false,lastValueVisible:!Number.isFinite(price),crosshairMarkerVisible:true,
        crosshairMarkerRadius:4,crosshairMarkerBorderColor:theme().background,crosshairMarkerBackgroundColor:color,
        priceFormat:{type:'price',precision,minMove:10**-precision},
        autoscaleInfoProvider:original=>{const info=original();if(info&&Number.isFinite(price)){info.priceRange.minValue=Math.min(info.priceRange.minValue,price);info.priceRange.maxValue=Math.max(info.priceRange.maxValue,price)}return info;},
      });
      series.setData(data);
      if(Number.isFinite(price)) series.createPriceLine({price,color,lineWidth:1,lineStyle:lib.LineStyle.Dashed,axisLabelVisible:true,title:'Quote'});
      if(Number.isFinite(previousClose))series.createPriceLine({price:previousClose,color:'#718198',lineWidth:1,lineStyle:lib.LineStyle.Dotted,axisLabelVisible:false,title:'Prev close'});
      element.querySelectorAll('[data-chart-style]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.chartStyle===style)));
      if(range)chart.timeScale().setVisibleLogicalRange(range);else chart.timeScale().fitContent();
    };
    setStyle('area');showPoint(latest);
    element.querySelector('[data-chart-summary]').textContent=`${data.length.toLocaleString()} observations · UTC`;
    canvas.setAttribute('aria-label',`${symbol||'Asset'} price history. Last observation ${format(latest.value)}. ${data.length} observations. Drag to pan or use zoom controls.`);
    chart.subscribeCrosshairMove(event=>{
      pending=event.point&&event.time?event.seriesData.get(series):null;
      if(!frame)frame=requestAnimationFrame(()=>{frame=0;showPoint(pending?.value!=null?pending:latest,Boolean(pending));});
    });
    click=event=>{
      const button=event.target.closest('button');if(!button||!element.contains(button))return;
      if(button.dataset.chartStyle){setStyle(button.dataset.chartStyle);return;}
      const action=button.dataset.chartAction;
      if(action==='fit'){chart.priceScale('right').applyOptions({autoScale:true});chart.timeScale().fitContent();showPoint(latest);return;}
      if(action==='zoom-in'||action==='zoom-out'){
        const range=chart.timeScale().getVisibleLogicalRange();if(!range)return;
        const center=(range.from+range.to)/2,half=Math.max(2,(range.to-range.from)/2*(action==='zoom-in'?.7:1.4));
        chart.timeScale().setVisibleLogicalRange({from:center-half,to:center+half});
      }
    };
    element.addEventListener('click',click);
  } catch(error) {
    if(token.cancelled)return;
    charts.get(element)?.();charts.delete(element);
    canvas.innerHTML='<div class="empty">Unable to render the price chart. Reload to retry.</div>';
    controls.forEach(b=>b.disabled=true);
    console.error('Price chart:',error);
  }
}

export async function mountComparisonChart(element,seriesData){
 if(!element)return;const canvas=element.querySelector('[data-chart-canvas]');const readout=element.querySelector('[data-chart-price]'),time=element.querySelector('[data-chart-time]');
 const valid=seriesData.map((s,i)=>({...s,color:['#c3ef70','#87b9ef','#d8a5ef','#eda870'][i%4],points:preparePriceHistory(s.points)})).filter(s=>s.points.length>=2);
 if(!valid.length){canvas.innerHTML='<div class="empty">Full-window performance chart unavailable.</div>';time.textContent='Insufficient dated observations';element.querySelectorAll('button').forEach(b=>b.disabled=true);return}
 const token={cancelled:false};charts.set(element,()=>{token.cancelled=true});
 try{const lib=await loadEngine();if(token.cancelled||!element.isConnected)return;canvas.replaceChildren();
 const chart=lib.createChart(canvas,{autoSize:true,layout:{background:{type:lib.ColorType.Solid,color:theme().background},textColor:theme().text,fontSize:11},grid:{vertLines:{color:theme().grid},horzLines:{color:theme().grid}},rightPriceScale:{borderColor:theme().grid},timeScale:{borderColor:theme().grid,timeVisible:false},localization:{priceFormatter:v=>v.toFixed(2)+'%'},handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true},kineticScroll:{touch:true,mouse:false}});
 const colors=['#c3ef70','#87b9ef','#d8a5ef','#eda870'];const series=valid.map((s,i)=>{const line=chart.addSeries(lib.LineSeries,{color:s.color,lineWidth:s.benchmark?1:2,lineStyle:s.benchmark?lib.LineStyle.Dashed:lib.LineStyle.Solid,title:s.symbol,priceFormat:{type:'custom',formatter:v=>v.toFixed(2)+'%',minMove:.01}});line.setData(s.points);return {line,s}});
 const latest=()=>{readout.textContent=valid.map(s=>s.symbol+': '+s.points.at(-1).value.toFixed(2)+'%').join(' · ');time.textContent='Price performance from each displayed baseline · UTC'};latest();
 chart.subscribeCrosshairMove(p=>{if(!p.time){latest();return}readout.textContent=series.map(({line,s})=>{const v=p.seriesData.get(line)?.value;return s.symbol+': '+(Number.isFinite(v)?v.toFixed(2)+'%':'—')}).join(' · ');time.textContent=new Date(p.time*1000).toISOString().slice(0,10)+' UTC'});
 const click=e=>{const b=e.target.closest('button');if(!b)return;const action=b.dataset.chartAction,scale=chart.timeScale();if(action==='fit'){scale.fitContent();return}const r=scale.getVisibleLogicalRange();if(r&&['zoom-in','zoom-out'].includes(action)){const middle=(r.from+r.to)/2,width=(r.to-r.from)*(action==='zoom-in'?.7:1.4);scale.setVisibleLogicalRange({from:middle-width/2,to:middle+width/2})}};
 element.querySelector('.chart-series-controls').remove();element.querySelector('.chart-currency').textContent='PRICE RETURN %';element.addEventListener('click',click);element.querySelector('[data-chart-summary]').textContent='Calculated price returns · dividends and FX excluded';chart.timeScale().fitContent();
 charts.set(element,()=>{token.cancelled=true;element.removeEventListener('click',click);chart.remove()});
 }catch{if(!token.cancelled)canvas.innerHTML='<div class="empty">Chart could not be loaded. Metrics remain available above.</div>'}
}
