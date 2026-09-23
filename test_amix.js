import { exec } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import path from 'path';

const input = path.join(process.cwd(), 'public', 'dummy.mp3');
const output = path.join(process.cwd(), 'public', 'exports', 'test_amix.mp3');

const filterComplex = '[0:a]volume=0.3[bg];[bg]amix=inputs=1:duration=first:dropout_transition=3[out]';
const ffmpegCmd = `"${ffmpegPath}" -y -i "${input}" -filter_complex "${filterComplex}" -map "[out]" "${output}"`;

exec(ffmpegCmd, (error, stdout, stderr) => {
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Success! File saved to:", output);
  }
});
