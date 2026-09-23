import { exec } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

const filterComplex = '[0:a]volume=0.3[bg];[bg]amix=inputs=1:duration=first:dropout_transition=3[out]';
const ffmpegCmd = `"${ffmpegPath}" -y -f lavfi -i anullsrc=r=44100:d=1 -filter_complex "${filterComplex}" -map "[out]" -f null /dev/null`;

exec(ffmpegCmd, (error, stdout, stderr) => {
  if (error) {
    console.log("Error:", error.message);
  } else {
    console.log("Success!");
  }
});
