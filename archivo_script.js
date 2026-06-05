document.addEventListener('DOMContentLoaded', function(){
  /* ========= CONFIG ========= */
  var JSON_CANDIDATES=[
    'https://mzappacoh.github.io/Proyecto_Tablero/status.json',
    'status.json'
  ];
  var JSON_URL=JSON_CANDIDATES[0];
  var REFRESH_SECONDS=15, ROWS=71, POZOS=6, LAST_N_TO_SHOW=10, REEL_SIZE=2;

  document.getElementById('autoN').textContent = LAST_N_TO_SHOW;

  var UA = navigator.userAgent || '';
  var IS_TV = /\b(Android TV|SMART-TV|HBBTV|BRAVIA|AFT|MiBOX|TCL)\b/i.test(UA) || /com\.tcl\.browser/i.test(UA);
  if (IS_TV) document.documentElement.classList.add('is-tv');

  var DEFAULT_VALUES_BASE = 'imagen';

  /* ========= UTILES ========= */
  var prefs={
    get:function(k,d){ try{ var v=localStorage.getItem(k); return v!==null?JSON.parse(v):d; }catch(_){ return d; } },
    set:function(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(_){} }
  };
  var clamp=function(v,a,b){ return Math.min(b,Math.max(a,v)); };
  var pad2=function(n){ return String(n).padStart(2,'0'); };
  var fmt1=function(n){ return (Math.round(n*10)/10).toString().replace('.',','); };

  var toRawURL=function(u){
    if(!u) return '';
    var m=u.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.*)$/);
    return m ? ('https://raw.githubusercontent.com/'+m[1]+'/'+m[2]+'/'+m[3]+'/'+m[4]) : u;
  };
  var VALUES_IMAGES=function(base){
    var b=(base||DEFAULT_VALUES_BASE); var raw=(b.endsWith('/')?b:(b+'/')); var r=toRawURL(raw);
    return [1,2,3,4,5,6].map(function(i){ return r + i + '.png'; });
  };

  function canonicalizeName(raw){
    var s=(raw==null?'':String(raw)).toUpperCase();
    s=s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    s=s.replace(/\s*:\s*$/,'');
    s=s.replace(/ARENA\s*MALLA\s*/g,'ARENA ');
    s=s.replace(/\s+/g,' ').trim();
    s=s.replace(/^GASOIL$/,'GAS OIL');
    return s;
  }

  /* ========= ESTADO PERSISTENTE ========= */
  var STOCK_RULES=prefs.get('stock:rules',{
    [canonicalizeName('GAS OIL')]:{display:'GAS OIL',unit:'M3',low:50,mid:150},
    [canonicalizeName('ARENA #100')]:{display:'ARENA #100',unit:'Tn',low:100,mid:300},
    [canonicalizeName('ARENA #30/70')]:{display:'ARENA #30/70',unit:'Tn',low:300,mid:800},
    [canonicalizeName('GEL BOLSONES')]:{display:'GEL BOLSONES',unit:'ud',low:10,mid:25},
    [canonicalizeName('GEL TOTE')]:{display:'GEL TOTE',unit:'ud',low:5,mid:15},
  });

  var DISPLAY=prefs.get('display:cfg',{
    pozoFont:20, stockFont:16, cellFont:19,
    saver:{ mode:'valores-lluvia', rotateEveryMin:3, idleMinutes:30, gitBase:DEFAULT_VALUES_BASE },
    nightDim:{ enabled:true, startHour:1, endHour:6, dimLevel:0.65 },
    pixelShift:{ enabled:true, intervalMin:2, maxOffsetPx:2 },
    view:{ visibleWells:[1,2,3,4,5,6] },
    kpi: { useManual: true, manualSpeed: 8 }
  });
  
  if (!DISPLAY.kpi) DISPLAY.kpi = { useManual: true, manualSpeed: 8 };
  if (!DISPLAY.view || !Array.isArray(DISPLAY.view.visibleWells)) {
    DISPLAY.view = { visibleWells:[1,2,3,4,5,6] };
    prefs.set('display:cfg', DISPLAY);
  }
  if (IS_TV) DISPLAY.pixelShift.enabled = false;

  /* ========= ESTADO RUNTIME ========= */
  var paused=prefs.get('ui:paused',false);
  var prevDataMap={}, latestDataMap={}, isFetching=false;
  var lastActivityTs=Date.now(); var stockCache=[];
  var shiftTimer=null, nightTimer=null, saverTO=null, rotator=null;
  var rafAnim=null; var sprites=[]; var testingTO=null;

  /* ========= DOM ========= */
  var tbody=document.getElementById('tbody');
  var hdrTop=document.getElementById('hdrTop'), hdrSub=document.getElementById('hdrSub');
  var tableContainer=document.getElementById('tableContainer');
  var autoScroll=document.getElementById('autoScroll');
  var lastUpdateEl=document.getElementById('lastUpdate'), deltaEl=document.getElementById('delta'), net=document.getElementById('netStatus');
  var stockBar=document.getElementById('stockBar');
  var btnRefresh=document.getElementById('btnRefresh'), btnPause=document.getElementById('btnPause'), btnFull=document.getElementById('btnFull'), btnSettings=document.getElementById('btnSettings');
  var datesReel=document.getElementById('datesReel');

  /* KPIs */
  var kpiTotal=document.getElementById('kpiTotal'),
      kpiDone=document.getElementById('kpiDone'),
      kpiRemain=document.getElementById('kpiRemain'),
      kpiAvg=document.getElementById('kpiAvg'),
      kpiWindow=document.getElementById('kpiWindow'),
      kpiETA=document.getElementById('kpiETA');

  var modal=document.getElementById('settingsModal');
  var setPozoFont=document.getElementById('setPozoFont'), setStockFont=document.getElementById('setStockFont'), setCellFont=document.getElementById('setCellFont');
  var setSaverMode=document.getElementById('setSaverMode'), setRotateEvery=document.getElementById('setRotateEvery'), setSaverIdle=document.getElementById('setSaverIdle');
  var setNightEnabled=document.getElementById('setNightEnabled'), setNightStart=document.getElementById('setNightStart'), setNightEnd=document.getElementById('setNightEnd'), setNightDim=document.getElementById('setNightDim');
  var setShiftEnabled=document.getElementById('setShiftEnabled'), setShiftEvery=document.getElementById('setShiftEvery'), setShiftPixels=document.getElementById('setShiftPixels');
  var setUseManualSpeed=document.getElementById('setUseManualSpeed'), setManualSpeed=document.getElementById('setManualSpeed');
  
  var btnSave=document.getElementById('btnSaveSettings'), btnClose=document.getElementById('btnCloseSettings'), btnReset=document.getElementById('btnReset');
  var btnLoadDetected=document.getElementById('btnLoadDetected'), btnAddRule=document.getElementById('btnAddRule'), rulesBody=document.getElementById('rulesBody');
  var btnTestSaver=document.getElementById('btnTestSaver'), saverStatus=document.getElementById('saverStatus');
  var wellChooser=document.getElementById('wellChooser');

  /* ========= ZOOM LOGIC ========= */
  var zoomLevel = prefs.get('ui:zoom', 1.0);
  var txtZoom = document.getElementById('txtZoom');
  
  function applyZoom(z){
    z = clamp(z, 0.5, 1.5);
    zoomLevel = z;
    document.body.style.zoom = zoomLevel; 
    if(typeof document.body.style.zoom === 'undefined' || document.body.style.zoom === ''){
        document.body.style.transform = 'scale('+zoomLevel+')';
        document.body.style.transformOrigin = '0 0';
        document.body.style.width = (100/zoomLevel)+'%';
        document.body.style.height = (100/zoomLevel)+'%';
    }
    txtZoom.textContent = Math.round(zoomLevel*100) + '%';
    prefs.set('ui:zoom', zoomLevel);
    requestAnimationFrame(fitRowsToViewport);
  }
  document.getElementById('btnZoomOut').onclick = function(){ applyZoom(zoomLevel - 0.05); };
  document.getElementById('btnZoomIn').onclick = function(){ applyZoom(zoomLevel + 0.05); };

  /* ========= HEADER ACCIONES ========= */
  autoScroll.checked=prefs.get('ui:autoScroll',true);
  btnPause.innerText=paused?'Reanudar':'Pausar';
  document.getElementById('refreshSec').innerText=REFRESH_SECONDS;

  btnRefresh.onclick=function(){ forceRefresh(); };
  btnPause.onclick=function(){ paused=!paused;prefs.set('ui:paused',paused);btnPause.innerText=paused?'Reanudar':'Pausar'; };
  autoScroll.onchange=function(){ prefs.set('ui:autoScroll',autoScroll.checked); if(autoScroll.checked) requestAnimationFrame(function(){ scrollToLastWithData(LAST_N_TO_SHOW); }); };

  function enterFull(){ var el=document.documentElement; (el.requestFullscreen||el.webkitRequestFullscreen||el.msRequestFullscreen||el.mozRequestFullScreen||function(){}).call(el); }
  function exitFull(){ (document.exitFullscreen||document.webkitExitFullscreen||document.msExitFullscreen||document.mozCancelFullScreen||function(){}).call(document); }
  btnFull.onclick=function(){ var fs=document.fullscreenElement||document.webkitFullscreenElement||document.msFullscreenElement||document.mozFullScreenElement; fs?exitFull():enterFull(); };

  btnSettings.onclick=openSettings;
  btnClose.onclick=function(){ modal.style.display='none'; };
  btnReset.onclick=function(){ localStorage.removeItem('stock:rules');localStorage.removeItem('display:cfg');location.reload(); };

  btnSave.onclick=function(){
    try{
      saveSettings(true);
      fitRowsToViewport();
      applyWellVisibility();
      if (autoScroll.checked) setTimeout(function(){ scrollToLastWithData(LAST_N_TO_SHOW); }, 0);
      net.textContent='Ajustes guardados';
      net.style.background='rgba(0,180,60,.25)'; net.style.borderColor='rgba(0,180,60,.35)';
    }catch(err){
      console.error(err);
      net.textContent='Error guardando ajustes';
      net.style.background='rgba(220,60,60,.25)'; net.style.borderColor='rgba(220,60,60,.4)';
      modal.style.display='none';
    }
  };
  btnLoadDetected.onclick=mergeDetectedItems;
  btnAddRule.onclick=function(){ addRuleRow({display:'',unit:'',low:'',mid:''}); };
  btnTestSaver.addEventListener('click', function(e){ e.preventDefault(); e.stopImmediatePropagation(); saveSettings(false); modal.style.display='none'; setTimeout(function(){ showSaver(true); },0); clearTimeout(testingTO); testingTO=setTimeout(hideSaver,12000); });

  /* ========= ACTIVIDAD ========= */
  var activityEvts=['mousemove','pointermove','touchmove','touchstart','click','wheel','keydown'];
  var lastInput={x:null,y:null,t:0};
  activityEvts.forEach(function(ev){ window.addEventListener(ev,markActivity,{passive:true}); });
  function markActivity(e){
    var now=Date.now();
    if(e && (e.type==='mousemove' || e.type==='pointermove' || e.type==='touchmove')){
      var p = (e && e.touches && e.touches[0]) ? e.touches[0] : e;
      var x = p && typeof p.clientX==='number' ? p.clientX : 0;
      var y = p && typeof p.clientY==='number' ? p.clientY : 0;
      if(lastInput.x!=null){
        var dx=Math.abs(x-lastInput.x), dy=Math.abs(y-lastInput.y), dt=now-lastInput.t;
        if(dx<4 && dy<4 && dt<350) return;
      }
      lastInput={x:x,y:y,t:now};
    }
    lastActivityTs=now; hideSaver(); scheduleSaver();
  }
  window.addEventListener('keydown',function(e){ if(e.key==='Escape'){modal.style.display='none'; hideSaver();}});

  /* ========= TABLA ========= */
  function initializeDOM(){
    for(var i=1;i<=POZOS;i++){
      var thTop=document.createElement('th'); thTop.className='pozo-'+i+' pozoTop'; thTop.dataset.p=i; thTop.colSpan=3; thTop.innerText='POZO #'+i; hdrTop.appendChild(thTop);
      var thSeq=document.createElement('th'); thSeq.className='seq'; thSeq.dataset.p=i; thSeq.innerText='F/h TPN'; hdrSub.appendChild(thSeq);
      var th1=document.createElement('th'); th1.dataset.p=i; th1.innerText='TPN'; hdrSub.appendChild(th1);
      var th2=document.createElement('th'); th2.dataset.p=i; th2.innerText='FRACTURADO'; hdrSub.appendChild(th2);
    }
    var frag=document.createDocumentFragment();
    for(var r=0;r<ROWS;r++){
      var id='#'+String(r).padStart(2,'0');
      var tr=document.createElement('tr'); tr.dataset.rowId=id; if(r%2===0) tr.classList.add('alt');
      var tdId=document.createElement('td'); tdId.className='rowid'; tdId.innerText=id; tr.appendChild(tdId);
      for(var p=1;p<=POZOS;p++){
        var tdS=document.createElement('td'); tdS.dataset.col='Seq'+p; tdS.className='seq'; tr.appendChild(tdS);
        var td1=document.createElement('td'); td1.dataset.col='Pozo'+p; tr.appendChild(td1);
        var td2=document.createElement('td'); td2.dataset.col='Estado'+p; tr.appendChild(td2);
      }
      frag.appendChild(tr);
    }
    tbody.appendChild(frag);
    applyFontVars();
  }
  function applyFontVars(){
    document.documentElement.style.setProperty('--pozo-font-size', DISPLAY.pozoFont+'px');
    document.documentElement.style.setProperty('--stock-font-size', DISPLAY.stockFont+'px');
    document.documentElement.style.setProperty('--cell-font-size',  DISPLAY.cellFont+'px');
  }
  function fitRowsToViewport(){
    var vvH = (window.visualViewport&&window.visualViewport.height) || window.innerHeight;
    var headerRect = document.querySelector('header').getBoundingClientRect();
    var footerH = (document.querySelector('footer') && document.querySelector('footer').offsetHeight) || 0;
    var available = Math.max(120, vvH - headerRect.height - 12 - footerH - 12);
    var headH = hdrTop.offsetHeight + hdrSub.offsetHeight;
    var inner = Math.max(60, available - headH);
    var target = Math.floor(inner / ROWS);
    var rowH = clamp(target, 26, 72);
    document.documentElement.style.setProperty('--row-h', rowH+'px');
  }

  /* ========= FECHAS / DATOS ========= */
  var excelSerialToDateTime = function(num){
    var baseUTC = Date.UTC(1899,11,30);
    var ms = Math.round(num * 86400000);
    var d = new Date(baseUTC + ms);
    return { y:d.getUTCFullYear(), m:d.getUTCMonth()+1, d:d.getUTCDate(), hh:d.getUTCHours(), mm:d.getUTCMinutes() };
  };
  function parseDateTimeAny(val){
    var s=(val==null?'':String(val)).trim();
    if(!s) return null;
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if(m){ var d=+m[1], mo=+m[2], y=+m[3], hh=+(m[4]||0), mm=+(m[5]||0); return {date:(d+'/'+mo+'/'+y), time:(pad2(hh)+':'+pad2(mm))}; }
    var dIso = new Date(s);
    if(!Number.isNaN(+dIso)){ return {date:(dIso.getDate()+'/'+(dIso.getMonth()+1)+'/'+dIso.getFullYear()), time:(pad2(dIso.getHours())+':'+pad2(dIso.getMinutes()))}; }
    if(/^-?\d+(\.\d+)?$/.test(s)){
      var n=Number(s.replace(',','.'));
      if(Number.isFinite(n)&&n>=30000&&n<=70000){ var o=excelSerialToDateTime(n); return {date:(o.d+'/'+o.m+'/'+o.y), time:(pad2(o.hh)+':'+pad2(o.mm))}; }
    }
    return null;
  }
  var excelSerialToYMD=function(num){ var base=Date.UTC(1899,11,30); var ms=base+Math.round(num)*86400000; var d=new Date(ms); return{y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate()}; };
  function parseDateValue(val){
    var s=(val==null?'':String(val)).trim(); if(!s) return null;
    var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m){var y=+m[1],mo=+m[2],d=+m[3]; return {display:(d+'/'+mo+'/'+y),normalized:(y+'-'+pad2(mo)+'-'+pad2(d))};}
    m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if(m){var d2=+m[1],mo2=+m[2],y2=+m[3]; return {display:(d2+'/'+mo2+'/'+y2),normalized:(y2+'-'+pad2(mo2)+'-'+pad2(d2))};}
    if(/^-?\d+(\.\d+)?$/.test(s)){var n=Number(s.replace(',','.')); if(Number.isFinite(n)&&n>=30000&&n<=70000){var ymd=excelSerialToYMD(n); return {display:(ymd.d+'/'+ymd.m+'/'+ymd.y),normalized:(ymd.y+'-'+pad2(ymd.m)+'-'+pad2(ymd.d))};}}
    return null;
  }
  var maybeFormatDate=function(v){ var p=parseDateValue(v); return p?p.display:(v==null?'':v); };
  var isStop=function(v){ return String(v==null?'':v).trim().toUpperCase()==='STOP'; };
  var isCancelada=function(v){ return String(v==null?'':v).trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()==='cancelada'; };
  var isFechaValida=function(v){ return parseDateValue(v)!==null; }

  function transformItems(items){
    if(!Array.isArray(items)) return [];
    return items.map(function(raw){
      var o={};
      o.fila=String((raw.Fila!=null?raw.Fila:(raw.fila!=null?raw.fila:'')));
      for(var i=1;i<=POZOS;i++){
        o['Seq'+i]=String((raw['SecuenciaPozo'+i]!=null?raw['SecuenciaPozo'+i]:''));    // F/h
        o['Pozo'+i]=String((raw['TPNPozo'+i]!=null?raw['TPNPozo'+i]:''));
        o['Estado'+i]=String((raw['FechaFracPozo'+i]!=null?raw['FechaFracPozo'+i]:'')); // FRACTURADO
      }
      return o;
    });
  }
  function extractHeaderRows(c){ var h=c.filter(function(it){return (it.fila||'').trim()==='';}); return {top:h[0]||null, sub:h[1]||null}; }
  function itemsArrayToMap(c){ var m={}; for(var i=0;i<c.length;i++){ var it=c[i]; var k=(it.fila||'').toString().trim(); if(!k) continue; m[k]=it; } return m; }

  /* ========= STOCK ========= */
  function numFromString(s){ if(!s) return NaN; var m=String(s).replace(',', '.').match(/-?\d+(\.\d+)?/); return m?parseFloat(m[0]):NaN; }
  function stockLevelClass(canon,val){
    var rule=STOCK_RULES[canon];
    if(!rule||!Number.isFinite(val)) return 'stock-mid';
    if(val<rule.low) return 'stock-low';
    if(val<=rule.mid) return 'stock-mid';
    return 'stock-high';
  }
  var themeMap=new Map();
  function renderStock(arr){
    stockCache=Array.isArray(arr)?arr:[];
    stockBar.innerHTML='';
    var idx=0;
    for(var i=0;i<stockCache.length;i++){
      var it=stockCache[i];
      var raw=String(it.ITEM||'');
      var canon=canonicalizeName(raw);
      if(!themeMap.has(canon)) themeMap.set(canon,(idx++)%8);
      var theme='stock-theme-'+themeMap.get(canon);
      var valStr=String(it.STOCK==null?'':it.STOCK);
      var val=numFromString(valStr);
      var cls=stockLevelClass(canon,val);
      var div=document.createElement('div'); div.className='pill '+theme+' '+cls;
      var dot=document.createElement('span'); dot.className='dot';
      var txt=document.createElement('span'); txt.textContent=raw+': '+valStr;
      div.appendChild(dot); div.appendChild(txt); stockBar.appendChild(div);
    }
  }

  /* ========= ENCABEZADOS / TABLA ========= */
  function updateHeaderNames(topRow, subRow){
    if(!topRow && !subRow) return;
    var n=[];
    for(var i=1;i<=POZOS;i++){
      var pTop=topRow && topRow['Pozo'+i] ? String(topRow['Pozo'+i]).trim() : '';
      var eTop=topRow && topRow['Estado'+i] ? String(topRow['Estado'+i]).trim() : '';
      var pSub=subRow && subRow['Pozo'+i] ? String(subRow['Pozo'+i]).trim() : '';
      var eSub=subRow && subRow['Estado'+i] ? String(subRow['Estado'+i]).trim() : '';
      var t=pTop||pSub||('POZO #'+i); var s=eTop||'';
      if(!s && eSub && !/^TPN$/i.test(eSub)) s=eSub;
      n.push((t+(s?(' '+s):'' )).trim());
    }
    var pozoTops=hdrTop.querySelectorAll('th.pozoTop');
    for(var j=0;j<pozoTops.length;j++){ pozoTops[j].innerText=n[j]||('POZO #'+(j+1)); }
    var sub=hdrSub.querySelectorAll('th');
    for(var p=1;p<=POZOS;p++){
      var b=(p-1)*3+1;
      if(sub[b])   sub[b].innerText='F/h TPN';
      if(sub[b+1]) sub[b+1].innerText='TPN';
      if(sub[b+2]) sub[b+2].innerText='FRACTURADO';
    }
  }

  function renderFHCell(val){
    var dt = parseDateTimeAny(val);
    if(!dt) return '';
    return '<div class="fh"><span class="d">'+dt.date+'</span><br><span class="t">'+dt.time+'</span></div>';
  }

  function updateRowCells(rowId,data){
    var tr=tbody.querySelector('tr[data-row-id="'+rowId+'"]'); if(!tr) return{changed:false,cells:0};
    var ch=false,c=0;
    for(var p=1;p<=POZOS;p++){
      var tdS=tr.querySelector('td[data-col="Seq'+p+'"]'),
          td1=tr.querySelector('td[data-col="Pozo'+p+'"]'),
          td2=tr.querySelector('td[data-col="Estado'+p+'"]');
      var vS=data && data['Seq'+p] ? String(data['Seq'+p]) : '';
      var v1=data && data['Pozo'+p] ? String(data['Pozo'+p]) : '';
      var raw=(data && data['Estado'+p]!=null)?data['Estado'+p]:'';
      var v2=maybeFormatDate(raw);

      var fhHTML = renderFHCell(vS);
      if(tdS && tdS.innerHTML!==fhHTML){tdS.innerHTML=fhHTML; ch=true;c++;}
      if(td1 && td1.innerText!==v1){td1.innerText=v1; ch=true;c++;}
      if(td2 && td2.innerText!==v2){td2.innerText=v2; ch=true;c++;}
      if(td2){ td2.classList.toggle('stop',      isStop(raw)||isStop(v2)); }
      if(td2){ td2.classList.toggle('cancelada', isCancelada(raw));        }
    }
    return{changed:ch,cells:c};
  }

  function updateDOM(map){
    var total=0;
    for(var i=0;i<ROWS;i++){
      var id='#'+String(i).padStart(2,'0');
      var obj=map[id]||{};
      var s=JSON.stringify(obj);
      var prev=prevDataMap[id];
      if(prev===undefined){
        prevDataMap[id]=s; latestDataMap[id]=obj;
        var r1=updateRowCells(id,obj); total+=r1.cells; continue;
      }
      if(prev!==s){
        var r2=updateRowCells(id,obj); total+=r2.cells; prevDataMap[id]=s; latestDataMap[id]=obj;
      } else {
        latestDataMap[id]=obj;
      }
    }
    return {changedCellsTotal:total};
  }

  /* ========= REEL FECHAS / FRACTURAS ========= */
  var datesArr=[], reelStart=prefs.get('reel:start',0), userMovedReel=prefs.get('reel:moved',false);
  function computeFractureStats(conv){
    var f=new Map(); var tot=0;
    for(var i=0;i<conv.length;i++){
      var it=conv[i];
      if(!it.fila||!it.fila.trim()) continue;
      for(var p=1;p<=POZOS;p++){
        var pdt=parseDateValue(it['Estado'+p]);      // solo FECHA
        if(pdt){tot++; var cur=f.get(pdt.normalized); if(cur) cur.count++; else f.set(pdt.normalized,{display:pdt.display,count:1,normalized:pdt.normalized});}
      }
    }
    return {total:tot,freq:f};
  }
  function updateDatesArray(freq){
    datesArr=Array.from(freq.values()).sort(function(a,b){ return a.normalized.localeCompare(b.normalized); });
    var max=Math.max(0,datesArr.length-REEL_SIZE);
    reelStart=userMovedReel?Math.min(reelStart,max):max;
    prefs.set('reel:start',reelStart);
    renderDatesReel();
  }
  function renderDatesReel(){
    var el=datesReel; el.innerHTML='';
    if(!datesArr.length){ var d=document.createElement('div'); d.className='pill'; d.textContent='Sin fechas'; el.appendChild(d); return; }
    var max=Math.max(0,datesArr.length-REEL_SIZE);
    var prev=document.createElement('button'); prev.className='reel-btn'; prev.textContent='‹'; prev.disabled=(reelStart===0);
    prev.onclick=function(){ reelStart=Math.max(0,reelStart-REEL_SIZE); userMovedReel=true; prefs.set('reel:moved',true); prefs.set('reel:start',reelStart); renderDatesReel(); };
    el.appendChild(prev);
    for(var k=0;k<REEL_SIZE;k++){
      var idx=reelStart+k; if(idx>=datesArr.length) break;
      var d2=datesArr[idx];
      var chip=document.createElement('div'); chip.className='date-chip'+(idx===datesArr.length-1?' latest':'');
      var dd=document.createElement('div'); dd.className='date'; dd.textContent=d2.display;
      var nn=document.createElement('div'); nn.className='num'; nn.textContent=d2.count;
      chip.appendChild(dd); chip.appendChild(nn); el.appendChild(chip);
    }
    var next=document.createElement('button'); next.className='reel-btn'; next.textContent='›'; next.disabled=(reelStart>=max);
    next.onclick=function(){ reelStart=Math.min(max,reelStart+REEL_SIZE); userMovedReel=true; prefs.set('reel:moved',true); prefs.set('reel:start',reelStart); renderDatesReel(); };
    el.appendChild(next);
  }

  /* ===== CÁLCULO UNIFICADO DE TOTALES Y BADGES ===== */
  // REPARACIÓN: Unifica el criterio de conteo para Totales Globales y Píldoras
 function computeAllStats(conv){
    var rows = conv
      .filter(function(it){ return it.fila && it.fila.trim(); })
      .map(function(it){
        var m = it.fila.trim().match(/^#?(\d+)/);
        return Object.assign({}, it, { _row: m ? parseInt(m[1],10) : NaN });
      })
      .filter(function(it){ return Number.isFinite(it._row) && it._row < ROWS; })
      .sort(function(a,b){ return a._row - b._row; });

    var totalSlots=0, totalHechas=0, totalCanceladas=0;
    var badges = new Array(POZOS).fill(0);

    for (var p=1; p<=POZOS; p++){
      var stopLimit = -1;
      var lastDataLimit = -1;

      for (var i=0; i<rows.length; i++){
        if (rows[i]._row === 0) continue;
        var v = (rows[i]['Estado'+p] || '').toString().trim().toUpperCase();
        var vNorm = (rows[i]['Estado'+p] || '').toString().trim()
                    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
        var t = (rows[i]['Pozo'+p] || '').toString().trim();
        if (v === 'STOP'){ stopLimit = rows[i]._row; break; }
        if (v !== '' || t !== '') { lastDataLimit = rows[i]._row; }
      }

      var limit = 0;
      if (stopLimit !== -1) {
          limit = stopLimit;
      } else if (lastDataLimit !== -1) {
          limit = lastDataLimit + 1;
      }

      var slotsPozo = 0, hechasPozo = 0, canceladasPozo = 0;
      for (var j=0; j<rows.length; j++){
        var r = rows[j];
        if (r._row === 0) continue;
        if (r._row >= limit) break;

        // Suma al total siempre
        slotsPozo++;

        var estadoNorm = (r['Estado'+p] || '').toString().trim()
                         .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

        // Cancelada: suma al total, se descuenta de restantes, NO suma a hechas
        if (estadoNorm === 'cancelada') {
          canceladasPozo++;
          continue;
        }

        if (isFechaValida(r['Estado'+p])) hechasPozo++;
      }

      totalSlots      += slotsPozo;
      totalHechas     += hechasPozo;
      totalCanceladas += canceladasPozo;

      // Badge = pendientes reales (ni hechas ni canceladas)
      badges[p-1] = Math.max(0, slotsPozo - hechasPozo - canceladasPozo);
    }

    return {
      totalSlots:  totalSlots,
      hechas:      totalHechas,
      // Restantes = slots - hechas - canceladas
      restantes:   Math.max(0, totalSlots - totalHechas - totalCanceladas),
      badges:      badges
    };
  }
  
  function paintBadgesPerPozo(arr){
    var ths=document.querySelectorAll('#hdrTop th.pozoTop');
    for(var i=0;i<ths.length;i++){
      var th=ths[i];
      [].slice.call(th.querySelectorAll('.badge')).forEach(function(b){ b.remove(); });
      var val=arr[i]||0;
      if(val>0){ var b=document.createElement('span'); b.className='badge'; b.textContent=val; th.appendChild(b); }
    }
  }

  /* ===== Promedio y ETA ===== */
  function computeAverageAndETA(freq, restantes){
    var keys = Array.from(freq.keys()).sort();
    var realAvg = 0;
    var usedDays = 0;

    if (keys.length > 0) {
        function startOfDay(d){ var x=new Date(d); x.setHours(0,0,0,0); return x; }
        function fromNorm(s){ var a=s.split('-').map(Number); return new Date(a[0], a[1]-1, a[2]); }
        function toNorm(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

        var today = startOfDay(new Date());
        var yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
        var start = startOfDay(fromNorm(keys[0]));

        if(start <= yesterday){
            var counts = [];
            for (var d=new Date(start); d<=yesterday; d.setDate(d.getDate()+1)) {
              var k = toNorm(d);
              var rec = freq.get(k);
              counts.push(rec ? rec.count : 0);
            }
            var slice = counts.length > 7 ? counts.slice(counts.length - 7) : counts;
            usedDays = slice.length;
            var sum = slice.reduce(function(a,b){ return a+b; }, 0);
            realAvg = usedDays > 0 ? (sum / usedDays) : 0;
        }
    }

    var calcSpeed = realAvg; 
    var isManual = false;

    if (DISPLAY.kpi && DISPLAY.kpi.useManual && DISPLAY.kpi.manualSpeed > 0) {
        calcSpeed = DISPLAY.kpi.manualSpeed;
        isManual = true;
    }

    var etaText = '—';
    if (calcSpeed > 0 && restantes > 0) {
        var now = new Date();
        function hoursLeftUntilCutoff(n){
          var end = new Date(n);
          end.setHours(23,59,59,999); 
          return (end - n) / 36e5;
        }
        var hoursNeeded = (restantes / calcSpeed) * 24;
        var hoursLeftToday = hoursLeftUntilCutoff(now);

        var approx;
        if (hoursNeeded <= hoursLeftToday) {
          approx = '≈ hoy';
        } else {
          var daysNeeded = Math.ceil(hoursNeeded / 24);
          approx = '≈ ' + daysNeeded + ' día' + (daysNeeded===1 ? '' : 's');
        }

        var target = new Date(now.getTime() + hoursNeeded*3600*1000);
        var roundTo = 5; 
        var m = target.getMinutes();
        target.setMinutes(Math.round(m/roundTo)*roundTo, 0, 0);

        var dateLabel = target.getDate() + '/' + (target.getMonth()+1) + '/' + target.getFullYear();
        var timeLabel = pad2(target.getHours()) + ':' + pad2(target.getMinutes());
        etaText = dateLabel + ' (' + approx + ') · ~ ' + timeLabel;
    }

    return { 
        realAvg: realAvg,       
        usedDays: usedDays,     
        etaText: etaText,       
        calcSpeed: calcSpeed,   
        isManual: isManual      
    };
  }

  /* ========= PROTECCIONES / SAVER ========= */
  function inRangeHour(h,a,b){ return (a<=b)?(h>=a&&h<b):(h>=a||h<b); }

  function applyNightDim(){ 
    var wrap=document.getElementById('dimVeil'); 
    if(!DISPLAY.nightDim || !DISPLAY.nightDim.enabled){ wrap.style.opacity=0; return; } 
    var h=new Date().getHours(); 
    var on=inRangeHour(h, DISPLAY.nightDim.startHour, DISPLAY.nightDim.endHour);
    wrap.style.opacity = on ? String(1 - clamp(DISPLAY.nightDim.dimLevel, 0.2, 1)) : '0'; 
  }

  function restartNight(){ clearInterval(nightTimer); applyNightDim(); nightTimer=setInterval(applyNightDim,5*60*1000); }

  function restartShift(){ 
    clearInterval(shiftTimer); 
    document.documentElement.style.setProperty('--nudge-x','0px'); 
    document.documentElement.style.setProperty('--nudge-y','0px'); 
    if(!DISPLAY.pixelShift || !DISPLAY.pixelShift.enabled) return; 
    var ms=Math.max(1, DISPLAY.pixelShift.intervalMin)*60*1000; 
    shiftTimer=setInterval(function(){ 
      var m=Math.max(0, DISPLAY.pixelShift.maxOffsetPx|0); 
      var x=(Math.floor(Math.random()*(m*2+1))-m); 
      var y=(Math.floor(Math.random()*(m*2+1))-m); 
      document.documentElement.style.setProperty('--nudge-x',x+'px'); 
      document.documentElement.style.setProperty('--nudge-y',y+'px'); 
    }, ms); 
  }

  function buildSaverFrame(){ 
    var x=30+Math.random()*40, y=25+Math.random()*40; 
    var sEl=document.getElementById('saver');
    sEl.style.setProperty('--blob-x',x+'%'); 
    sEl.style.setProperty('--blob-y',y+'%'); 
    document.getElementById('saverTicker').textContent=new Date().toLocaleString()+'  —  (mover mouse/tecla para salir)'; 
  }

  function clearSaver(){ 
    var saverStage=document.getElementById('saverStage'); 
    saverStage.innerHTML=''; 
    sprites=[]; 
    if(rafAnim){ cancelAnimationFrame(rafAnim); rafAnim=null; } 
    if(rotator){ clearInterval(rotator); rotator=null; } 
  }

  function startBounce(images){ 
    clearSaver(); 
    var saverStage=document.getElementById('saverStage'); 
    
    var W=saverStage.clientWidth, H=saverStage.clientHeight; 
    var n=Math.min(images.length, 8); 
    sprites=[]; 
    for(var i=0;i<n;i++){ 
      var img=document.createElement('img'); 
      img.src=images[i%images.length]; 
      img.className='bImg'; 
      img.style.position='absolute';
      img.style.willChange='transform';
      saverStage.appendChild(img); 
      var w0=180, h0=100; 
      sprites.push({el:img, x:Math.random()*(W-w0), y:Math.random()*(H-h0), vx:(Math.random()<.5?-1:1)*(1.2+Math.random()), vy:(Math.random()<.5?-1:1)*(1.2+Math.random()), w:w0, h:h0}); 
    }
    var step=function(){ 
      for(var s of sprites){ 
        s.x+=s.vx; s.y+=s.vy; 
        if(s.x<=0){s.x=0;s.vx*=-1;} if(s.y<=0){s.y=0;s.vy*=-1;} 
        if(s.x+s.w>=W){s.x=W-s.w;s.vx*=-1;} if(s.y+s.h>=H){s.y=H-s.h;s.vy*=-1;} 
        s.el.style.transform='translate3d('+s.x+'px,'+s.y+'px, 0)'; 
      }
      rafAnim=requestAnimationFrame(step); 
    }; 
    rafAnim=requestAnimationFrame(step); 
  }

  function startStarfall(images){ 
    clearSaver(); 
    var saverStage=document.getElementById('saverStage'); 
    
    var W=saverStage.clientWidth, H=saverStage.clientHeight; 
    var N=Math.min(images.length*3, 20); 
    sprites=[];
    for(var i=0;i<N;i++){ 
      var img=document.createElement('img'); 
      img.src=images[i%images.length]; 
      img.className='fallImg'; 
      img.style.position='absolute';
      img.style.willChange='transform';
      var scale=0.55+Math.random()*0.25; 
      var size=Math.min(window.innerWidth*0.10, 160) * scale; 
      img.style.width=size+'px'; 
      var x=Math.random()*(W-size); 
      var y=-Math.random()*H - size; 
      var sp={el:img, x:x, y:y, size:size, vx:(Math.random()-0.5)*0.5, vy:1.2+Math.random()*1.8, rot:(Math.random()*6-3), a:Math.random()*360}; 
      saverStage.appendChild(img); 
      sprites.push(sp); 
    }
    var step=function(){ 
      for(var s of sprites){ 
        s.y+=s.vy; s.x+=s.vx; s.a+=s.rot; 
        if(s.x<0) s.x=0; if(s.x+s.size>W) s.x=W-s.size; 
        if(s.y>H+50){ 
          s.y=-s.size - 20; 
          s.x=Math.random()*(W - s.size); 
        } 
        s.el.style.transform='translate3d('+s.x+'px,'+s.y+'px, 0) rotate('+s.a+'deg)'; 
      } 
      rafAnim=requestAnimationFrame(step); 
    }; 
    rafAnim=requestAnimationFrame(step); 
  }

  function applySaverMode(mode){ 
    clearSaver(); 
    var imgs=VALUES_IMAGES(DISPLAY.saver.gitBase); 
    if(mode==='valores-rebotando') return startBounce(imgs); 
    if(mode==='valores-lluvia') return startStarfall(imgs); 
  }

  function showSaver(force){ 
    if(force!==true) force=false; 
    var idleMs=Math.max(1, DISPLAY.saver.idleMinutes)*60*1000; 
    if(!force && (Date.now()-lastActivityTs)<idleMs) return; 
    buildSaverFrame(); 
    document.getElementById('saver').style.display='block'; 
    document.getElementById('saverStatus').textContent='Mostrando'; 
    var modes=['blob','valores-rebotando','valores-lluvia']; 
    if(DISPLAY.saver.mode==='rotar'){ 
      var idx=0; 
      applySaverMode(modes[idx]); 
      rotator=setInterval(function(){ 
        idx=(idx+1)%modes.length; 
        applySaverMode(modes[idx]); 
      }, Math.max(1, DISPLAY.saver.rotateEveryMin)*60*1000); 
    } else { 
      applySaverMode(DISPLAY.saver.mode); 
    } 
  }

  function hideSaver(){ 
    document.getElementById('saver').style.display='none'; 
    document.getElementById('saverStatus').textContent='—'; 
    clearSaver(); 
  }

  function scheduleSaver(){ 
    clearTimeout(saverTO); 
    var idleMs=Math.max(1, DISPLAY.saver.idleMinutes)*60*1000; 
    var wait=Math.max(0, idleMs-(Date.now()-lastActivityTs)); 
    saverTO=setTimeout(function(){ showSaver(false); }, wait+100); 
  }

  /* ========= CARGA ========= */
  function tryFetch(url){ 
    var freshUrl = url + (url.indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now();
    return fetch(freshUrl, {cache:'no-store', mode:'cors'}).then(function(res){ 
      if(!res.ok) throw new Error('HTTP '+res.status); 
      JSON_URL=url; 
      return res.json(); 
    }); 
  }
  function fetchJSON(){ return tryFetch(JSON_CANDIDATES[0]).catch(function(){ return tryFetch(JSON_CANDIDATES[1]); }); }
  function setNet(status, ok, extra){ net.textContent = (status || '') + (extra?(' '+extra):''); if(ok){ net.style.background='rgba(0,180,60,.2)'; net.style.borderColor='rgba(0,180,60,.35)'; }else{ net.style.background='rgba(220,60,60,.25)'; net.style.borderColor='rgba(220,60,60,.4)'; } }

  async function forceRefresh(){ if(isFetching) return; btnRefresh.disabled=true; var t=btnRefresh.textContent; btnRefresh.textContent='Actualizando...'; await loadAndRender(true); btnRefresh.textContent=t; btnRefresh.disabled=false; }
  
  async function loadAndRender(isForced){
    if(isForced!==true) isForced=false;
    if(paused && !isForced) return; if(isFetching) return; isFetching=true;
    try{
      var t0=performance.now();
      var json=await fetchJSON();
      var t1=performance.now();
      setNet('OK', true, Math.round(t1-t0)+'ms');

      document.getElementById('lastUpdate').innerText=(json.lastUpdate?new Date(json.lastUpdate):new Date()).toLocaleString();

      renderStock(json.stock||[]);
      var conv=transformItems(json.items||[]);
      var hdr=extractHeaderRows(conv); updateHeaderNames(hdr.top,hdr.sub);
      var map=itemsArrayToMap(conv);
      var changed=updateDOM(map).changedCellsTotal;
      deltaEl.textContent=changed>0?('• '+changed+' cambio(s)'):'';

      var stats=computeFractureStats(conv);
      updateDatesArray(stats.freq);

      // CÁLCULO UNIFICADO
      var allStats = computeAllStats(conv);
      kpiTotal.textContent = allStats.totalSlots;
      kpiDone.textContent  = allStats.hechas;
      kpiRemain.textContent= allStats.restantes;

      var avgData = computeAverageAndETA(stats.freq, allStats.restantes);
      
      kpiAvg.textContent = (avgData.realAvg > 0 ? fmt1(avgData.realAvg) : '—') + (avgData.realAvg > 0 ? ' etapas/día' : '');
      document.getElementById('kpiWindow').textContent = 'Ventana usada: ' + (avgData.usedDays||0) + ' día(s)';

      kpiETA.textContent = avgData.etaText;
      
      var labelETA = kpiETA.parentElement.querySelector('.kpi-label');
      if(avgData.isManual){
          labelETA.innerHTML = 'Fin estimado <span style="color:#ffcc66;font-size:10px">(Base: '+avgData.calcSpeed+' et/día)</span>';
      } else {
          labelETA.textContent = 'Fin estimado';
      }

      paintBadgesPerPozo(allStats.badges);

      if(changed>0){ lastActivityTs=Date.now(); hideSaver(); scheduleSaver(); }
      if(autoScroll.checked) requestAnimationFrame(function(){ scrollToLastWithData(LAST_N_TO_SHOW); });
      requestAnimationFrame(fitRowsToViewport);
    }catch(e){
      console.error(e);
      setNet('ERROR:', false, (e&&e.message?e.message:'')); 
      document.getElementById('lastUpdate').innerHTML='<span style="color:salmon">Error de conexión</span>';
      deltaEl.textContent='';
    }finally{ isFetching=false; }
  }

  /* ====== Autoscroll ====== */
  function hasVisibleData(o, visibleSet){
    if(!o) return false;
    var wells = (visibleSet && visibleSet.size) ? visibleSet : new Set([1,2,3,4,5,6]);
    for (var p of wells) {
      var t = (o['Pozo'+p]||'').toString().trim();
      var e = o['Estado'+p];
      if (t !== '' || (e && !isStop(e) && isFechaValida(e))) return true;
    }
    return false;
  }
  function scrollToLastWithData(n){
    if(typeof n!=='number') n=LAST_N_TO_SHOW;
    if(!autoScroll.checked) return;

    var rows=[].slice.call(tbody.querySelectorAll('tr'));
    var visibleSet = new Set(
      (DISPLAY.view && Array.isArray(DISPLAY.view.visibleWells))
        ? DISPLAY.view.visibleWells
        : [1,2,3,4,5,6]
    );

    var idx=[];
    rows.forEach(function(tr,i){
      var id=tr.dataset.rowId;
      if(hasVisibleData(latestDataMap[id], visibleSet)) idx.push(i);
    });
    if(!idx.length) return;

    var startIndex = idx[Math.max(0, idx.length - n)];
    var startRow   = rows[startIndex];
    if(!startRow) return;

    var headerH = hdrTop.offsetHeight + hdrSub.offsetHeight;
    var targetTop = Math.max(0, startRow.offsetTop - headerH - 8);
    var cur = tableContainer.scrollTop;
    if (Math.abs(cur - targetTop) > 4) {
      tableContainer.scrollTo({ top: targetTop, behavior: 'smooth' });
    }
  }

  /* ========= VISTA (Pozos visibles) ========= */
  function buildWellChooser(){
    if(!wellChooser) return;
    wellChooser.innerHTML='';
    var current = (DISPLAY.view && Array.isArray(DISPLAY.view.visibleWells))
      ? DISPLAY.view.visibleWells.slice()
      : [1,2,3,4,5,6];
    for(var p=1;p<=POZOS;p++){
      (function(pp){
        var lab=document.createElement('label');
        var chk=document.createElement('input'); chk.type='checkbox'; chk.value=String(pp);
        chk.checked = current.indexOf(pp)>=0;
        chk.onchange=function(){
          var set = new Set(DISPLAY.view && DISPLAY.view.visibleWells || []);
          if(chk.checked) set.add(pp); else set.delete(pp);
          var arr=Array.from(set).sort(function(a,b){return a-b;});
          if(arr.length===0){ arr=[1]; chk.checked=true; }
          DISPLAY.view = { visibleWells: arr };
        };
        lab.appendChild(chk); lab.appendChild(document.createTextNode(' Pozo '+pp));
        wellChooser.appendChild(lab);
      })(p);
    }
  }
  function applyWellVisibility(){
    var visible = (DISPLAY.view && Array.isArray(DISPLAY.view.visibleWells))
      ? new Set(DISPLAY.view.visibleWells)
      : new Set([1,2,3,4,5,6]);
    var topThs=hdrTop.querySelectorAll('th.pozoTop');
    for(var i=0;i<topThs.length;i++){ var p=i+1; topThs[i].style.display = visible.has(p)?'':'none'; }
    var ths = hdrSub.querySelectorAll('th');
    for(var p=1;p<=POZOS;p++){
      var b=(p-1)*3+1;
      for(var k=0;k<3;k++){ var el=ths[b+k]; if(el) el.style.display = visible.has(p)?'':'none'; }
    }
    var trs=tbody.querySelectorAll('tr');
    for(var r=0;r<trs.length;r++){
      var tr=trs[r];
      for(var p2=1;p2<=POZOS;p2++){
        ['Seq','Pozo','Estado'].forEach(function(type){
          var td=tr.querySelector('td[data-col="'+type+p2+'"]');
          if(td) td.style.display = visible.has(p2)?'':'none';
        });
      }
    }
  }

  /* ========= MODAL ========= */
  function openSettings(){
    setPozoFont.value=DISPLAY.pozoFont; setStockFont.value=DISPLAY.stockFont; setCellFont.value=DISPLAY.cellFont;
    setSaverMode.value=DISPLAY.saver.mode; setRotateEvery.value=DISPLAY.saver.rotateEveryMin; setSaverIdle.value=DISPLAY.saver.idleMinutes;
    setNightEnabled.checked=!!DISPLAY.nightDim.enabled; setNightStart.value=DISPLAY.nightDim.startHour; setNightEnd.value=DISPLAY.nightDim.endHour; setNightDim.value=Math.round((DISPLAY.nightDim.dimLevel||0.65)*100);
    setShiftEnabled.checked=!!DISPLAY.pixelShift.enabled; setShiftEvery.value=DISPLAY.pixelShift.intervalMin; setShiftPixels.value=DISPLAY.pixelShift.maxOffsetPx;
    
    var kpi = DISPLAY.kpi || { useManual: true, manualSpeed: 8 };
    setUseManualSpeed.checked = !!kpi.useManual;
    setManualSpeed.value = kpi.manualSpeed || 8;

    drawRulesTable(); buildWellChooser(); modal.style.display='flex';
  }
  function saveSettings(close){
    if(close!==false) close=true;
    DISPLAY.pozoFont=clamp(+setPozoFont.value||20,12,40);
    DISPLAY.stockFont=clamp(+setStockFont.value||16,10,30);
    DISPLAY.cellFont=clamp(+setCellFont.value||19,12,32);
    DISPLAY.saver.mode=setSaverMode.value;
    DISPLAY.saver.rotateEveryMin=clamp(+setRotateEvery.value||3,1,60);
    DISPLAY.saver.idleMinutes=clamp(+setSaverIdle.value||2,1,120);
    DISPLAY.saver.gitBase = DISPLAY.saver.gitBase || DEFAULT_VALUES_BASE;
    DISPLAY.nightDim.enabled=!!setNightEnabled.checked;
    DISPLAY.nightDim.startHour=clamp(+setNightStart.value||1,0,23);
    DISPLAY.nightDim.endHour=clamp(+setNightEnd.value||6,0,23);
    DISPLAY.nightDim.dimLevel=clamp((+setNightDim.value||65)/100,0.2,1);
    DISPLAY.pixelShift.enabled=!!setShiftEnabled.checked;
    DISPLAY.pixelShift.intervalMin=clamp(+setShiftEvery.value||2,1,60);
    DISPLAY.pixelShift.maxOffsetPx=clamp(+setShiftPixels.value||2,0,10);

    DISPLAY.kpi = {
        useManual: !!setUseManualSpeed.checked,
        manualSpeed: clamp(+setManualSpeed.value||8, 0.1, 100)
    };

    var rows=[].slice.call(rulesBody.querySelectorAll('.rule-row')); var next={};
    for(var i=0;i<rows.length;i++){
      var r=rows[i];
      var name=r.querySelector('[data-f=name]').value, unit=r.querySelector('[data-f=unit]').value;
      var low=+r.querySelector('[data-f=low]').value, mid=+r.querySelector('[data-f=mid]').value;
      if(!name) continue; var canon=canonicalizeName(name);
      next[canon]={display:name.trim(),unit:(unit||'').trim(),low:(Number.isFinite(low)?low:0),mid:(Number.isFinite(mid)?mid:0)};
    }
    STOCK_RULES=next;

    prefs.set('display:cfg',DISPLAY); prefs.set('stock:rules',STOCK_RULES);
    applyFontVars(); restartNight(); restartShift(); scheduleSaver(); renderStock(stockCache);
    if(close) modal.style.display='none';
  }
  function drawRulesTable(){ rulesBody.innerHTML=''; var entries=Object.entries(STOCK_RULES); for(var i=0;i<entries.length;i++){ addRuleRow(entries[i][1]); } }
  function addRuleRow(rule){
    rule=rule||{};
    var row=document.createElement('div'); row.className='rule-row';
    row.innerHTML='<input data-f="name" value="'+(rule.display||'')+'" placeholder="Nombre visible">'+
                   '<input data-f="unit" value="'+(rule.unit||'')+'" placeholder="ud/Tn/M3">'+
                   '<input data-f="low" value="'+(rule.low!=null?rule.low:'')+'" type="number" step="any">'+
                   '<input data-f="mid" value="'+(rule.mid!=null?rule.mid:'')+'" type="number" step="any">'+
                   '<button class="btn secondary" type="button">Quitar</button>';
    row.querySelector('button').onclick=function(){ row.remove(); };
    rulesBody.appendChild(row);
  }
  function mergeDetectedItems(){
    var detected=new Map(Object.entries(STOCK_RULES));
    for(var i=0;i<stockCache.length;i++){
      var it=stockCache[i];
      var canon=canonicalizeName(it.ITEM);
      if(!detected.has(canon)) detected.set(canon,{display:String(it.ITEM||''),unit:'',low:0,mid:0});
    }
    STOCK_RULES=Object.fromEntries(detected.entries()); drawRulesTable();
  }

  /* ========= INIT ========= */
  function applyDisplay(){ applyFontVars(); restartNight(); restartShift(); scheduleSaver(); }
  initializeDOM(); applyDisplay(); fitRowsToViewport(); applyWellVisibility();
  
  applyZoom(zoomLevel);
  
  loadAndRender(true);
  setInterval(function(){ loadAndRender(false); }, REFRESH_SECONDS*1000);

  var fitRowsRaf = function(){ requestAnimationFrame(fitRowsToViewport); };
  window.addEventListener('resize',fitRowsRaf);
  window.addEventListener('orientationchange',fitRowsRaf);
  ['fullscreenchange','webkitfullscreenchange','mozfullscreenchange','MSFullscreenChange'].forEach(function(ev){ document.addEventListener(ev,fitRowsRaf); });
});
