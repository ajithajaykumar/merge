const yts = require('yt-search');
yts('po nee po song').then(r => {
  console.log('Got videos:', r.videos.length);
}).catch(e => {
  console.error('Error:', e);
});
