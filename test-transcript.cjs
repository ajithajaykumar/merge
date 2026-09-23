const { YoutubeTranscript } = require('youtube-transcript');

async function test() {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript('ryR2-jVjoeA');
    console.log(transcript);
  } catch(e) {
    console.error(e);
  }
}
test();
