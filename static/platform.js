const native = () => Boolean(window.Capacitor?.isNativePlatform());

export async function request(path,options={}) {
  const origin = globalThis.SHAREBAJAR_API_URL || '';
  if (native() && !origin) throw Error('The mobile app needs a configured backend.');
  const {timeout=30000,signal,...fetchOptions}=options;
  const controller=new AbortController();
  const abort=()=>controller.abort(signal.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new DOMException('Request timed out','TimeoutError')),timeout);
  try {
    const response=await fetch(origin+'/api/'+path,{...fetchOptions,signal:controller.signal});
    let data;try{data=await response.json()}catch{const error=Error('The server returned an invalid response. Please retry.');error.status=response.status;throw error;}
    if(!response.ok){const error=Error(data.error||'Request failed');error.status=response.status;error.code=data.code;error.requiredPlan=data.requiredPlan;throw error;}
    return data;
  }catch(error){if(controller.signal.aborted&&!signal?.aborted)throw Error('The request timed out. Please retry.');throw error;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export async function exportBackup(state,filename='sharebajar-backup.json') {
  const contents = JSON.stringify(state, null, 2);
  if (native()) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'), import('@capacitor/share')
    ]);
    const file = await Filesystem.writeFile({ path: filename, data: contents,
      directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: filename==='sharebajar-backup.json'?'ShareBajar portfolio backup':'ShareBajar AI report', files: [file.uri] });
    return;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function initializeMobile(onBack) {
  if (!native()) return;
  document.documentElement.classList.add('native-app');
  const { App } = await import('@capacitor/app');
  await App.addListener('backButton', async ({ canGoBack }) => {
    const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
    if (dialog) { dialog.classList.remove('chart-expanded'); dialog.close(); return; }
    if (onBack()) return;
    if (canGoBack) history.back(); else await App.exitApp();
  });
}
