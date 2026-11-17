# Verifica voce e lingue — 17 novembre 2026

Base esaminata: main `552e6c90aff6ce94c19f969e9ce64fdc05e4cdb8`.
L'issue #20 è contesto storico: Gemini/Orus e il limite 2000 non descrivono più la voce corrente. Il codice usa xAI /v1/tts, eve, PCM mono 24 kHz. Nessun segreto o prompt DB è stato letto, nessuna produzione modificata.

## Matrice dei problemi osservati

| Caso | Codice di partenza | Correzione / limite |
|---|---|---|
| Testo italiano | Prompt italiano | Italiano predefinito; scelta esplicita disponibile |
| Darija araba | Prompt italiano, TTS it | Politica linguistica segue messaggio/scelta; TTS auto |
| Darija latina | Nessun instradamento dedicato | Istruzione al modello, NON rilevatore linguistico verificato |
| Misto italiano/Darija | Comportamento non specificato | Italiano in caso ambiguo, richiesta esplicita prevale |
| Voce Darija in ingresso | STT it-IT fisso | Selettore it-IT / ar-MA; supporto browser da verificare |
| TTS | eve, lingua it per tutto | eve preservata; auto per Darija/misto, it per italiano esplicito |
| Risposta >5000 caratteri | Segmentazione esistente, taglio a 8000 | Nessuna nuova segmentazione; rimosso taglio dimostrato a 8000 |
| Stop | Token prima di playback, ma nessun controllo dopo await resume/unmount | Token anche dopo attese, chiusura sorgente/context, unmount definitivo |
| Pausa/Riprendi | Assenti | Suspend/resume dello stesso AudioContext e posizione; audio pendente trattenuto |
| Errori TTS | Segmenti falliti saltati | Errore visibile; Play riparte dall'inizio |
| Abuso TTS guest | Endpoint pubblico senza quota | Massimo 2 richieste attive e 80.000 caratteri/minuto per processo; nessun IP o contenuto registrato |

## Contratto provider e prompt personalizzato

Fonte verificata: https://docs.x.ai/developers/model-capabilities/audio/text-to-speech (17 novembre 2026). Il contratto documenta `auto`, `it` e varianti arabe; non documenta `ar-MA` come garanzia di Darija. `ar-MA` è solo la scelta Web Speech Recognition. Il fallback TTS `auto` è dichiarato nell'interfaccia, senza cambiare provider o voce e senza promessa di pronuncia marocchina. La traslitterazione latina richiede ascolto reale.

Il prompt custom resta letto con la stessa precedenza dal DB. Si aggiunge soltanto una politica di lingua a runtime: non si riscrivono i valori né le altre istruzioni di ruolo/sicurezza. Un admin può allineare manualmente la sola frase linguistica nel pannello, conservando le proprie regole; nessun aggiornamento DB fa parte della PR.

La quota è una protezione locale, non un limite di spesa distribuito. I guest restano ammessi. Più processi hanno budget indipendenti; un attaccante può esaurire il budget comune. Serve un controllo condiviso prima di considerare risolta l'esposizione pubblica ai costi.

## Matrice end-to-end da ascoltare (BLOCKED / REQUIRES HUMAN AUDIO CHECK)

| Caso | Selezione | Messaggio | Testo atteso | TTS | Playback reale / umano |
|---|---|---|---|---|---|
| Italiano | Italiano, mic it-IT | Buongiorno, spiegami come preparare la richiesta. | Italiano | it, eve | NOT RUN / no |
| Darija araba | Darija, mic ar-MA | سلام، كيف داير؟ بغيت نفهم شنو خاصني ندير باش نوجد الطلب. شرح ليا المراحل بشوية، وإذا شي حاجة ما واضحةش سولني قبل ما تجاوب. | Darija naturale, più frasi | auto, eve | NOT RUN / no |
| Darija latina | Darija | Salam, kif dayr? Bghit nfhem chno khasni ndir bach nwejjed talab. Chra7 lia lmarahil bchwiya. | Darija coerente con richiesta | auto, eve | NOT RUN / no |
| Misto | Segui messaggio | Ciao, labas? Spiegami in italiano i passaggi. | Italiano | auto, eve | NOT RUN / no |
| Override | Darija | Rispondi in italiano: cosa devo preparare? | Italiano | auto, eve | NOT RUN / no |

Per ogni riga: verificare testo e selezione, ascoltare l'intera risposta; Play → Pausa → Riprendi → Stop; Stop durante caricamento; rapidi cambi di messaggio; disattivare voce durante risposta in arrivo. Provare Chrome Android, Safari iOS e desktop; verificare tastiera e touch. Il riconoscimento ar-MA dipende dal browser e può essere impreciso. Nessuna piattaforma è dichiarata validata senza questa prova.

I mock verificano il contratto e la sequenza software; NON dimostrano comprensione del modello, riconoscimento Darija, audio udibile o qualità della pronuncia. Non sono state fatte chiamate TTS a pagamento.

## Verifiche eseguite

- PASS: `node_modules/.bin/tsc --noEmit`.
- PASS: `node_modules/.bin/vitest run --exclude server/gemini.test.ts --exclude server/tts.test.ts`: 100 test, 9 file. I due test storici esclusi effettuano chiamate esterne; i nuovi test provider usano mock.
- PASS: `npm run build`, con avvisi sulle variabili analytics mancanti e sul bundling dello script analytics preesistente.
- PASS: `git diff --check`.
- NOT RUN: modello reale, STT reale, ascolto italiano/Darija, controlli audio su telefono/browser. Accettazione audio: BLOCKED / REQUIRES HUMAN AUDIO CHECK.
- Installazione: pnpm di ambiente (11) incompatibile con il lockfile; riuscita con `npx --yes pnpm@10.4.1 install --frozen-lockfile --ignore-scripts`, senza modificare dipendenze o lockfile.
- Quota distribuita: follow-up https://github.com/Lucifer-AI-666/adam-mesh/issues/22.
