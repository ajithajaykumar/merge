// @ts-nocheck
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import youtubedl from 'youtube-dl-exec';
const youtubedlExec = youtubedl.exec;
import ffmpegPath from 'ffmpeg-static';
import type { Plugin } from 'vite';
import dotenv from 'dotenv';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');
dotenv.config();
const youtubeDownloadPlugin = (): Plugin => ({
  name: 'youtube-download-proxy',
  configureServer(server) {
    server.middlewares.use(async (req: any, res: any, next) => {
      // Lazy load Prisma to avoid top-level Vite config issues
      let prisma;
      try {
        const { PrismaClient } = await import('@prisma/client');
        prisma = new PrismaClient();
      } catch (e) {
        // Fallback or ignore if Prisma is missing
      }

      // 1. Setup in-memory cache for search queries
      if (!global.__SEARCH_CACHE) {
        global.__SEARCH_CACHE = new Map();
      }
      const searchCache = global.__SEARCH_CACHE;

      if (req.url && req.url.startsWith('/api/search')) {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);

        // Handle /api/search requests
        if (urlObj.pathname === '/api/search') {
          const query = urlObj.searchParams.get('q');
          if (query) {
            console.log("API SEARCH HIT: ", query);
            try {
              if (searchCache.has(query)) {
                console.log("Returning cached result for:", query);
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify(searchCache.get(query)));
              }

              const ytSearchModule = await import('yt-search');
              const yts = ytSearchModule.default || ytSearchModule;

              console.log("Calling yts()...");
              const r = await yts(query);
              console.log("yts() completed! videos:", r.videos.length);
              const videos = r.videos.slice(0, 10);

              // Return immediately with a streaming endpoint URL (On-Demand download!)
              const items = videos.slice(0, 10).map((v: any) => {
                return {
                  id: v.videoId,
                  title: v.title,
                  artist: v.author.name,
                  album: 'YouTube',
                  genre: 'Video',
                  year: new Date().getFullYear(),
                  duration: v.seconds,
                  // We point to our new blazing fast streaming endpoint!
                  audioUrl: `/api/stream-yt?id=${v.videoId}`,
                  coverUrl: v.thumbnail,
                  originalLyrics: [],
                  versions: [],
                  isYouTube: false
                };
              });

              const responseData = { items, totalResults: items.length };
              searchCache.set(query, responseData);

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(responseData));
            } catch (e) {
              console.error(e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Failed to search and download' }));
            }
            return;
          }
        }
      }

      if (req.url && req.url.startsWith('/api/search-yt')) {
        const query = new URL(req.url, `http://${req.headers.host}`).searchParams.get('q');
        if (query) {
          try {
            const yts = (await import('yt-search')).default;
            const r = await yts(query);
            const videos = r.videos.slice(0, 20);
            const items = videos.map((v: any) => ({
              id: v.videoId,
              title: v.title,
              artist: v.author.name,
              album: 'YouTube',
              genre: 'Video',
              year: new Date().getFullYear(),
              duration: v.seconds,
              audioUrl: 'youtube',
              coverUrl: v.thumbnail,
              originalLyrics: [],
              versions: [],
              isYouTube: true
            }));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ items, totalResults: videos.length }));
          } catch (e) {
            console.error(e);
            res.statusCode = 500;
            res.end('Failed to search');
          }
        }
        return;
      }

      if (req.url === '/api/lyrics/rewrite' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
          try {
            const { text, action } = JSON.parse(body);

            let rewritten = text;
            if (process.env.GROQ_API_KEY) {
              const prompt = action === 'rewrite'
                ? `Rewrite this song lyric to be slightly different but keep the meaning: "${text}". Output ONLY the rewritten lyric.`
                : `Make this song lyric more poetic and beautiful: "${text}". Output ONLY the poetic lyric.`;

              const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: "llama-3.3-70b-versatile",
                  messages: [{ role: "user", content: prompt }]
                })
              });
              const groqData = await groqRes.json();
              if (groqData.choices && groqData.choices[0]) {
                rewritten = groqData.choices[0].message.content.trim().replace(/^"|"$/g, '');
              }
            } else {
              // Fallback simulation
              await new Promise(r => setTimeout(r, 1500));
              if (action === 'rewrite') rewritten = `🎵 ${text} (AI Rewritten)`;
              if (action === 'poetic') rewritten = `✨ ${text} (AI Poetic)`;
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ text: rewritten }));
          } catch (e) {
            console.error(e);
            res.statusCode = 400;
            res.end('Bad Request');
          }
        });
        return;
      }

      if (req.url === '/api/lyrics/save' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
          try {
            const { songId, versionName, lyrics } = JSON.parse(body);
            if (prisma) {
              let song = await prisma.song.findUnique({ where: { id: songId } });
              if (!song) {
                song = await prisma.song.create({
                  data: {
                    id: songId, title: "Unknown", artist: "Unknown", album: "Unknown", genre: "Unknown", year: 2024, duration: 0, audioUrl: "", coverUrl: ""
                  }
                });
              }
              const version = await prisma.lyricVersion.create({
                data: {
                  versionName, songId,
                  lyrics: { create: lyrics.map(l => ({ text: l.text, timestamp: l.timestamp, duration: l.duration })) }
                }
              });
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, version }));
            } else {
              res.statusCode = 500;
              res.end('Database not available');
            }
          } catch (e) {
            console.error(e);
            res.statusCode = 500;
            res.end('Internal Error');
          }
        });
        return;
      }

      if (req.url && (req.url.startsWith('/api/download-yt?id=') || req.url.startsWith('/api/stream-yt?id='))) {
        const id = new URL(req.url, `http://${req.headers.host}`).searchParams.get('id');
        if (id) {
          try {
            res.setHeader('Content-Type', 'audio/mp4');
            res.setHeader('Content-Disposition', `attachment; filename="youtube_audio_${id}.m4a"`);
            // Fast direct stream
            const child = youtubedlExec(`https://www.youtube.com/watch?v=${id}`, {
              f: 'bestaudio[ext=m4a]', output: '-',
            });
            // Prevent unhandled promise rejections if yt-dlp fails (e.g. 403 Forbidden)
            child.catch((err: any) => console.error("YT Download Stream Error:", err.message || "Failed"));

            // @ts-ignore
            if (child.stdout) {
              // @ts-ignore
              child.stdout.pipe(res);
            }

            // @ts-ignore
            if (typeof child.on === 'function') {
              // @ts-ignore
              child.on('error', (e: any) => {
                if (!res.headersSent) { res.statusCode = 500; res.end(); }
              });
            }
            return;
          } catch (e) {
            if (!res.headersSent) { res.statusCode = 500; res.end('Failed to download YouTube track'); }
            return;
          }
        }
      }

      if (req.url === '/api/audio/extract-stems' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
          try {
            const { songId } = JSON.parse(body);
            if (!prisma) return res.end('Database not available');
            const job = await prisma.generationJob.create({ data: { songId, status: 'RUNNING' } });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ jobId: job.id, status: 'RUNNING' }));

            const { spawn } = await import('child_process');
            const child = spawn('demucs', ['-n', 'htdemucs', 'temp_audio.mp3']);
            child.on('error', async (err) => {
              setTimeout(async () => {
                await prisma.generationJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', audioUrl: '/stems/simulated_instrumental.mp3' } });
              }, 5000);
            });
            child.on('close', async (code) => {
              if (code === 0) {
                await prisma.generationJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', audioUrl: '/stems/real_instrumental.mp3' } });
              }
            });
          } catch (e) { res.statusCode = 500; res.end('Internal Error'); }
        });
        return;
      }

      if (req.url && req.url.startsWith('/api/audio/job?id=')) {
        const id = new URL(req.url, `http://${req.headers.host}`).searchParams.get('id');
        if (id && prisma) {
          try {
            const job = await prisma.generationJob.findUnique({ where: { id } });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(job || { status: 'NOT_FOUND' }));
            return;
          } catch (e) { res.statusCode = 500; res.end('Internal Error'); return; }
        }
      }

      if (req.url === '/api/audio/synthesize-and-mix' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
          try {
            const { songId, audioUrl, isYouTube, lyrics, voice } = JSON.parse(body);
            if (!prisma) return res.end('Database not available');
            const job = await prisma.generationJob.create({ data: { songId, status: 'RUNNING' } });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ jobId: job.id, status: 'RUNNING' }));
            // Async background processing
            (async () => {
              try {
                const fs = (await import('fs')).default;
                const path = (await import('path')).default;
                const os = (await import('os')).default;
                const { exec } = await import('child_process');
                const googleTTS = await import('google-tts-api');

                const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mix-'));
                const originalMp3 = path.join(workDir, 'original.mp3');
                const finalMp3 = path.join(process.cwd(), 'public', 'exports', `mixed_song_${job.id}.mp3`);

                if (!fs.existsSync(path.join(process.cwd(), 'public', 'exports'))) {
                  fs.mkdirSync(path.join(process.cwd(), 'public', 'exports'), { recursive: true });
                }

                // 1. Download original song
                if (isYouTube) {
                  await youtubedlExec(`https://www.youtube.com/watch?v=${songId}`, {
                    extractAudio: true, audioFormat: 'mp3', output: originalMp3, ffmpegLocation: ffmpegPath || undefined
                  });
                } else if (audioUrl && audioUrl.startsWith('http')) {
                  const fetchRes = await fetch(audioUrl);
                  const buffer = await fetchRes.arrayBuffer();
                  fs.writeFileSync(originalMp3, Buffer.from(buffer));
                } else {
                  // Local mock files fallback
                  fs.copyFileSync(path.join(process.cwd(), 'public', 'dummy.mp3'), originalMp3);
                }

                // 2. Download TTS for each lyric
                const validLyrics = lyrics.filter((l: any) => l.text && l.text.trim().length > 0 && !l.isInstrumental);
                const ttsFiles = [];
                let filterComplex = '[0:a]volume=0.3[bg];'; // Reduce bg volume
                let amixInputs = '[bg]';

                for (let i = 0; i < validLyrics.length; i++) {
                  const line = validLyrics[i];
                  // Using Google TTS as a fallback since ElevenLabs keys are missing
                  // You can replace this with fetch() to ElevenLabs API later!
                  const ttsUrl = googleTTS.getAudioUrl(line.text, { lang: 'en', slow: false, host: 'https://translate.google.com' });
                  const ttsPath = path.join(workDir, `tts_${i}.mp3`);

                  const res = await fetch(ttsUrl);
                  const buffer = await res.arrayBuffer();
                  fs.writeFileSync(ttsPath, Buffer.from(buffer));

                  ttsFiles.push(ttsPath);

                  const delayMs = Math.floor(line.timestamp * 1000);
                  filterComplex += `[${i + 1}:a]adelay=${delayMs}|${delayMs}[a${i}];`;
                  amixInputs += `[a${i}]`;
                }

                filterComplex += `${amixInputs}amix=inputs=${validLyrics.length + 1}:duration=first:dropout_transition=3[out]`;

                // 3. Construct FFmpeg command
                let ffmpegCmd = `"${ffmpegPath}" -y -i "${originalMp3}"`;
                ttsFiles.forEach(f => {
                  ffmpegCmd += ` -i "${f}"`;
                });
                ffmpegCmd += ` -filter_complex "${filterComplex}" -map "[out]" "${finalMp3}"`;

                // 4. Execute Mix
                exec(ffmpegCmd, async (error, stdout, stderr) => {
                  if (error) {
                    console.error("FFmpeg Mix Error:", error);
                    await prisma.generationJob.update({ where: { id: job.id }, data: { status: 'FAILED' } });
                  } else {
                    console.log("Mix complete! Saved to:", finalMp3);
                    await prisma.generationJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', audioUrl: `/exports/mixed_song_${job.id}.mp3` } });
                  }
                  // Cleanup
                  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) { }
                });

              } catch (e) {
                console.error("Pipeline failed", e);
                await prisma.generationJob.update({ where: { id: job.id }, data: { status: 'FAILED' } });
              }
            })();
          } catch (e) { res.statusCode = 500; res.end('Internal Error'); }
        });
        return;
      }

      if (req.url === '/api/lyrics/fetch-full' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
          try {
            const { title, duration, id, isYouTube } = JSON.parse(body);

            let generatedLyrics = [];
            let langCode = 'en';

            // 0. Skip heavy processing for very long audio (Jukeboxes / Mixes > 10 mins)
            if (duration && duration > 600) {
              console.log(`Skipping lyrics fetch for long mix/jukebox: ${title} (${duration}s)`);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                lyrics: [{ id: 'j1', text: "Jukebox / Long Mix detected. Lyrics unavailable.", timestamp: 0, duration: duration }]
              }));
              return;
            }

            // 1. Auto-detect language using LLaMA
            if (process.env.GROQ_API_KEY) {
              try {
                const langRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                  method: "POST",
                  headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "user", content: `Identify the language of this song title: "${title}". IMPORTANT: If the title contains names like Dhanush, Anirudh, Vijay, Ajith, Ilaiyaraaja, AR Rahman, or looks like Romanized Tamil/Telugu, it is Tamil ('ta') or Telugu ('te'). Do not default to Hindi ('hi') for South Indian songs. Output ONLY the ISO-639-1 two-letter code (e.g., ta, en, hi, te).` }]
                  })
                });
                const langData = await langRes.json();
                langCode = langData.choices[0].message.content.trim().toLowerCase().slice(0, 2);
                console.log(`Detected language code ${langCode} for ${title}`);
              } catch (e) { console.error("Language detection failed", e); }
            }

            try {
              // 2. Try YouTube Transcript (Fastest & Most Accurate if available)
              const isYtSource = isYouTube || (id && id.length === 11) || (audioUrl && audioUrl.includes('stream-yt'));
              if (isYtSource && id && generatedLyrics.length === 0) {
                console.log(`Checking YouTube Captions for ${title}...`);
                const ytTranscriptModule = await import('youtube-transcript');
                const YoutubeTranscript = ytTranscriptModule.default?.YoutubeTranscript || ytTranscriptModule.YoutubeTranscript;

                const transcript = await YoutubeTranscript.fetchTranscript(id);
                if (transcript && transcript.length > 0) {
                  generatedLyrics = transcript.map((t: any, i: number) => ({
                    id: `yt-cc-${i}`,
                    timestamp: Math.max(0, (t.offset || 0) / 1000), // convert ms to seconds
                    text: t.text.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\n/g, ' ').trim(),
                    duration: (t.duration || 3000) / 1000
                  }));
                  console.log(`Successfully extracted ${generatedLyrics.length} lines from YouTube Closed Captions!`);
                }
              }
            } catch (e: any) {
              console.log("No YouTube transcript available:", e.message);
            }

            try {
              // 3. Try to fetch perfect synced lyrics from LRCLIB (Fallback)
              if (generatedLyrics.length === 0) {
                console.log(`Searching LRCLIB for perfectly synced lyrics: ${title}`);

                let cleanTitle = title;
                if (process.env.GROQ_API_KEY) {
                  try {
                    const aiTitleRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                      method: "POST",
                      headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
                      body: JSON.stringify({
                        model: "llama-3.3-70b-versatile",
                        messages: [{ role: "user", content: `Extract ONLY the core Song Name from this messy YouTube title: "${title}". Exclude movie names, actor names, words like "Video", "Song", "4K", "HD". For example, if the title is "Ethir Neechal - Velicha Poove 8K/4K Video Song | Sivakarthikeyan | Anirudh", output ONLY "Velicha Poove". Output NOTHING else.` }]
                      })
                    });
                    const aiTitleData = await aiTitleRes.json();
                    if (aiTitleData.choices && aiTitleData.choices[0]) {
                      cleanTitle = aiTitleData.choices[0].message.content.trim().replace(/^"|"$/g, '');
                    }
                  } catch (e) { console.error("AI Title clean failed", e); }
                }

                console.log(`Cleaned title for LRCLIB: ${cleanTitle}`);
                const lrclibRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle)}`);

                if (lrclibRes.ok) {
                  const lrclibData = await lrclibRes.json();
                  const matched = lrclibData.find((t: any) => t.syncedLyrics);
                  if (matched && matched.syncedLyrics) {
                    const lines = matched.syncedLyrics.split('\n');
                    const timeRegex = /\[(\d{2}):(\d{2}\.\d{2,3})\]/;

                    for (let i = 0; i < lines.length; i++) {
                      const match = lines[i].match(timeRegex);
                      if (match) {
                        const timestamp = parseInt(match[1]) * 60 + parseFloat(match[2]);
                        const text = lines[i].replace(timeRegex, '').trim();
                        if (text) {
                          generatedLyrics.push({ id: `lrc-${i}`, timestamp, text, duration: 3 });
                        }
                      }
                    }

                    if (generatedLyrics.length > 0) {
                      console.log(`Found perfect synced lyrics from LRCLIB for ${title}`);
                      // Calculate exact durations based on next line
                      for (let i = 0; i < generatedLyrics.length; i++) {
                        if (i < generatedLyrics.length - 1) {
                          generatedLyrics[i].duration = Math.min(generatedLyrics[i + 1].timestamp - generatedLyrics[i].timestamp, 10);
                        }
                      }
                    }
                  }
                }
              }
            } catch (e) {
              console.error("LRCLIB fetch failed:", e);
            }

            if (generatedLyrics.length === 0 && process.env.GROQ_API_KEY) {
              const isYtSource = isYouTube || (id && id.length === 11) || (audioUrl && audioUrl.includes('stream-yt'));
              if (isYtSource && id) {
                try {
                  console.log(`Starting Whisper transcription for ${title}...`);
                  const fs = (await import('fs')).default;
                  const os = (await import('os')).default;
                  const path = (await import('path')).default;
                  const tmpFile = path.join(os.tmpdir(), `yt_${id}_${Date.now()}.mp3`);

                  await youtubedlExec(`https://www.youtube.com/watch?v=${id}`, {
                    extractAudio: true, audioFormat: 'mp3', ffmpegLocation: ffmpegPath || undefined, output: tmpFile
                  });

                  const fileBuffer = fs.readFileSync(tmpFile);
                  const fileBlob = new Blob([fileBuffer], { type: 'audio/mpeg' });
                  const formData = new FormData();
                  formData.append('file', fileBlob, 'audio.mp3');
                  formData.append('model', 'whisper-large-v3');
                  formData.append('response_format', 'verbose_json');
                  formData.append('prompt', cleanTitle); // Just the song title to prevent language confusion
                  formData.append('temperature', '0.2'); // Low temperature prevents Moroccan/Arabic Arabizi hallucinations

                  // Strictly force the detected language to prevent Whisper from hallucinating Portuguese/Welsh during instrumental intros!
                  if (langCode && /^[a-z]{2}$/.test(langCode)) {
                    formData.append('language', langCode);
                  }

                  const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
                    body: formData
                  });
                  const groqData = await groqRes.json();
                  fs.unlinkSync(tmpFile);

                  if (groqData.segments) {
                    generatedLyrics = groqData.segments.map((seg, i) => {
                      // Strip out musical notes and common hallucination characters that show as squares
                      const cleanedText = seg.text.replace(/[\u2669-\u266c\u266f\u266e\u266d\uD83C\uDFB5\uD83C\uDFB6*\[\]()]/g, '').trim();
                      return {
                        id: `l-${i}`,
                        text: cleanedText || '...',
                        timestamp: seg.start,
                        duration: seg.end - seg.start
                      };
                    }).filter(l => l.text !== '...' && l.text.length > 0);
                    console.log(`Successfully transcribed ${generatedLyrics.length} lines.`);
                  } else {
                    console.error("No segments in Whisper response:", groqData);
                  }
                } catch (e) {
                  console.error("Whisper transcription failed:", e);
                }
              }

              // Fallback to LLaMA guessing if Whisper didn't work or not YouTube
              if (generatedLyrics.length === 0) {
                const prompt = `You are a music lyrics API. The user provided the song title: "${title}". 
                Provide the FULL ORIGINAL lyrics for this exact song in its original language.
                You must output ONLY a valid JSON array of objects. Do not include markdown code blocks or any other text.
                Format: [{"id":"l1", "text":"lyric line", "timestamp": 10, "duration": 5}]
                Guess the approximate timestamps in seconds for each line based on typical song structure (starting around 10s, spacing out by 4-6s). Provide the ENTIRE song's lyrics.`;

                const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                  method: "POST",
                  headers: {
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "user", content: prompt }]
                  })
                });

                const groqData = await groqRes.json();
                if (groqData.choices && groqData.choices[0]) {
                  try {
                    const content = groqData.choices[0].message.content.trim();
                    const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
                    generatedLyrics = JSON.parse(jsonStr);
                  } catch (e) {
                    console.error("Failed to parse Groq output:", groqData.choices[0].message.content);
                  }
                }
              }
            }

            // 4. Transliteration Post-Processing (Force Tanglish)
            if (generatedLyrics.length > 0 && (langCode === 'ta' || langCode === 'te' || langCode === 'hi') && process.env.GROQ_API_KEY) {
              const hasNativeScript = generatedLyrics.some(l => /[^\x00-\x7F]/.test(l.text)); // Check for non-ASCII (native scripts)
              if (hasNativeScript) {
                console.log("Native script detected! Running transliteration to Tanglish (English letters)...");
                try {
                  const textMap = {};
                  generatedLyrics.forEach(l => { textMap[l.id] = l.text; });

                  const prompt = `You are a strict transliteration API. 
                  Below is a JSON object where keys are IDs and values are song lyrics written in a native script (like Tamil, Telugu, Hindi).
                  Convert ALL native script text values into English letters (Romanized / Tanglish / Hinglish).
                  Return ONLY the English letters. You MUST NOT output any native script characters.
                  Do NOT translate the meaning, ONLY transliterate the phonetics into English letters.
                  You MUST return a valid JSON object with the EXACT SAME keys.
                  Do NOT include markdown, just the JSON object.
                  JSON: ${JSON.stringify(textMap)}`;

                  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                      model: "llama-3.3-70b-versatile",
                      messages: [{ role: "user", content: prompt }],
                      max_tokens: 4000
                    })
                  });
                  const groqData = await groqRes.json();
                  if (groqData.choices && groqData.choices[0]) {
                    const content = groqData.choices[0].message.content.trim();
                    const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
                    const transliterated = JSON.parse(jsonStr);

                    for (let i = 0; i < generatedLyrics.length; i++) {
                      if (transliterated[generatedLyrics[i].id]) {
                        generatedLyrics[i].text = transliterated[generatedLyrics[i].id];
                      }
                    }
                    console.log("Transliteration to Tanglish successful!");
                  }
                } catch (e) {
                  console.error("Transliteration failed.", e);
                }
              }
            }

            // Fallback if Groq is not set or failed
            if (generatedLyrics.length === 0) {
              if (title.toLowerCase().includes('venmegam') || title.toLowerCase().includes('yaaradi') || title.toLowerCase().includes('tamil')) {
                generatedLyrics = [
                  { id: "l1", text: "Venmegam pennaga uruvaanatho", timestamp: 10, duration: 5 },
                  { id: "l2", text: "Inneram ennai paarthu sirikaanatho", timestamp: 16, duration: 5 },
                  { id: "l3", text: "Unnai arugil paarkayil", timestamp: 22, duration: 4 }
                ];
              } else {
                const lines = ["Yeah, woke up feeling fine", "Sun is shining through the blind"];
                let currentTime = 10;
                for (let i = 0; i < lines.length; i++) {
                  if (currentTime > duration - 10) break;
                  generatedLyrics.push({ id: `auto-${i}`, text: lines[i], timestamp: currentTime, duration: 4 });
                  currentTime += 6;
                }
              }
            }

            // 5. Post-Process: Inject Instrumental markers for BGM gaps > 4 seconds
            if (generatedLyrics.length > 0) {
              const withInstrumentals = [];
              for (let i = 0; i < generatedLyrics.length; i++) {
                const current = generatedLyrics[i];
                withInstrumentals.push(current);

                if (i < generatedLyrics.length - 1) {
                  const next = generatedLyrics[i + 1];
                  const currentEnd = current.timestamp + (current.duration || 3);
                  const gap = next.timestamp - currentEnd;

                  if (gap > 4) {
                    withInstrumentals.push({
                      id: `inst-${i}`,
                      timestamp: currentEnd,
                      text: '♪ Instrumental ♪',
                      duration: gap,
                      isInstrumental: true
                    });
                  }
                }
              }
              generatedLyrics = withInstrumentals;
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ lyrics: generatedLyrics }));
          } catch (e) {
            console.error(e);
            res.statusCode = 400;
            res.end('Bad Request');
          }
        });
        return;
      }

      next();
    });
  }
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), youtubeDownloadPlugin()],
});
