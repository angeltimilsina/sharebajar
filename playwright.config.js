import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'*.spec.js',timeout:30000,workers:1,
  use:{baseURL:'http://127.0.0.1:3011',channel:'msedge',headless:true},
  projects:[
    {name:'desktop',use:{viewport:{width:1280,height:900}}},
    {name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}}
  ],
  webServer:{command:'python server.py --host 127.0.0.1 --port 3011',url:'http://127.0.0.1:3011/api/health',reuseExistingServer:false}
});
