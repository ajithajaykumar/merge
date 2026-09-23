const ytdl = require('youtube-dl-exec');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');

async function test() {
  console.log("FFMPEG PATH:", ffmpegPath);
  console.log("Testing youtube-dl-exec...");
  
  const id = 'dQw4w9WgXcQ';
  const child = ytdl.exec(`https://www.youtube.com/watch?v=${id}`, {
    extractAudio: true,
    audioFormat: 'mp3',
    ffmpegLocation: ffmpegPath,
    output: '-'
  });

  const writeStream = fs.createWriteStream('./test.mp3');
  child.stdout.pipe(writeStream);
  
  child.on('close', () => {
    console.log("Done streaming!");
    process.exit(0);
  });
  
  child.on('error', (err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}

test();
