const charts=new Map();
let engine;
const loadEngine=()=>engine??=import('./vendor/lightweight-charts.mjs');

export function disposeTechnicalCharts(root){
  for(const [element,dispose] of charts)if(!root||root===element||root.contains(element)){dispose();charts.delete(element)}
}

export async function mountTechnicalChart(root,data){
  disposeTechnicalCharts(root);
  const token={cancelled:false},instances=[];
  charts.set(root,()=>{token.cancelled=true;instances.forEach(chart=>chart.remove())});
  try{
    const lib=await loadEngine();
    if(token.cancelled||!root.isConnected)return;
    const makeChart=(element,height=340)=>lib.createChart(element,{
      autoSize:true,height,layout:{background:{type:lib.ColorType.Solid,color:'#10171f'},textColor:'#91a0b2',fontFamily:'Inter, system-ui, sans-serif',fontSize:11,attributionLogo:true},
      grid:{vertLines:{color:'#1d2835'},horzLines:{color:'#1d2835'}},
      rightPriceScale:{borderColor:'#2a3645',minimumWidth:72,scaleMargins:{top:.12,bottom:.12}},
      timeScale:{borderColor:'#2a3645',timeVisible:false,secondsVisible:false,rightOffset:6,minBarSpacing:.1},
      crosshair:{mode:lib.CrosshairMode.Magnet},
      handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
      handleScale:{axisPressedMouseMove:true,mouseWheel:true,pinch:true},
    });
    const candles=data.candles.map(c=>({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close}));
    const primary=makeChart(root.querySelector('[data-tech-price]'));instances.push(primary);
    const candleSeries=primary.addSeries(lib.CandlestickSeries,{upColor:'#b5dd80',downColor:'#f17c85',borderUpColor:'#b5dd80',borderDownColor:'#f17c85',wickUpColor:'#b5dd80',wickDownColor:'#f17c85',priceLineVisible:false});
    candleSeries.setData(candles);
    const lineConfig={
      sma20:{label:'SMA 20',color:'#72a7ff',width:1},
      sma50:{label:'SMA 50',color:'#e9bb62',width:1},
      sma200:{label:'SMA 200',color:'#e282d0',width:1},
      ema20:{label:'EMA 20',color:'#63d6ca',width:1},
      bollingerUpper:{label:'Bollinger upper',color:'#8190a6',width:1,style:lib.LineStyle.Dashed},
      bollingerLower:{label:'Bollinger lower',color:'#8190a6',width:1,style:lib.LineStyle.Dashed},
    };
    const overlaySeries=[];
    const applyOverlays=()=>{
      overlaySeries.splice(0).forEach(series=>primary.removeSeries(series));
      for(const input of root.querySelectorAll('[data-price-indicator]:checked')){
        const keys=input.dataset.priceIndicator==='bollingerUpper'?['bollingerUpper','bollingerLower']:[input.dataset.priceIndicator];
        for(const key of keys){
          const config=lineConfig[key],points=data.indicators?.[key];
          if(!config||!points?.length)continue;
          const series=primary.addSeries(lib.LineSeries,{color:config.color,lineWidth:config.width,lineStyle:config.style||lib.LineStyle.Solid,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
          series.setData(points);overlaySeries.push(series);
        }
      }
      const projection=data.projection;
      if(projection?.available){
        for(const [key,color,label] of [['lower','#e9bb62','Scenario lower'],['median','#c3ef70','Scenario median'],['upper','#e9bb62','Scenario upper']]){
          const series=primary.addSeries(lib.LineSeries,{color,lineWidth:key==='median'?2:1,lineStyle:key==='median'?lib.LineStyle.Dashed:lib.LineStyle.Dotted,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,title:label});
          series.setData([{time:projection.time,value:projection.current},{time:projection.futureTime,value:projection[key]}]);overlaySeries.push(series);
        }
      }
    };
    applyOverlays();primary.timeScale().fitContent();
    root.querySelectorAll('[data-price-indicator]').forEach(input=>input.addEventListener('change',applyOverlays));
    for(const [key,elementSelector,color] of [['rsi14','[data-tech-rsi]','#72a7ff'],['macd','[data-tech-macd]','#c3ef70']]){
      const seriesData=data.indicators?.[key]||[];
      if(!seriesData.length)continue;
      const pane=makeChart(root.querySelector(elementSelector),150);instances.push(pane);
      const line=pane.addSeries(lib.LineSeries,{color,lineWidth:1.5,priceLineVisible:false,lastValueVisible:true,crosshairMarkerVisible:false});
      line.setData(seriesData);
      if(key==='rsi14'){line.createPriceLine({price:70,color:'#f17c85',lineStyle:lib.LineStyle.Dotted,lineWidth:1,axisLabelVisible:false,title:'70'});line.createPriceLine({price:30,color:'#b5dd80',lineStyle:lib.LineStyle.Dotted,lineWidth:1,axisLabelVisible:false,title:'30'});}
      else{
        const signal=pane.addSeries(lib.LineSeries,{color:'#e9bb62',lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
        signal.setData(data.indicators?.macdSignal||[]);
        const histogram=pane.addSeries(lib.HistogramSeries,{priceLineVisible:false,lastValueVisible:false,base:0});
        histogram.setData((data.indicators?.macdHistogram||[]).map(point=>({time:point.time,value:point.value,color:point.value>=0?'#b5dd8080':'#f17c8580'})));
      }
      pane.timeScale().fitContent();
    }
  }catch(error){
    if(!token.cancelled){disposeTechnicalCharts(root);throw error}
  }
}
