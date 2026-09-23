async function test() {
  const googleTTS = await import('google-tts-api');
  console.log('Keys:', Object.keys(googleTTS));
  console.log('Has getAudioUrl:', typeof googleTTS.getAudioUrl === 'function');
  console.log('Has default.getAudioUrl:', typeof googleTTS.default?.getAudioUrl === 'function');
}
test();
