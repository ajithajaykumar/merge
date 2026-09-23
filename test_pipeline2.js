import googleTTS from 'google-tts-api';
try {
  googleTTS.getAudioUrl("This is a very long text that I am writing just to exceed the two hundred character limit set by google TTS api to see if it actually crashes the backend process resulting in a failed state for the ai voice generation pipeline of the user. I hope this works because otherwise I have no idea why it fails.", { lang: 'en', slow: false, host: 'https://translate.google.com' });
  console.log("Success");
} catch (e) {
  console.error("Failed:", e.message);
}
