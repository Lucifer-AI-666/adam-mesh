# ADAM Creative Studio — Video e musica

## Stato

Implementazione in branch, **non distribuita** sulla demo chatgpt.site. Il repository ADAM Civic Mesh e la demo Workbench sono prodotti differenti; cambiare GitHub non modifica quella demo.

Questa pagina aggiunge un'integrazione **reale ma opzionale** con un motore ComfyUI locale, senza attivare fornitori a pagamento e senza fabbricare file di esempio spacciandoli per generazioni. L'interfaccia è disponibile in ADAM su **/creative** dopo build e deploy autorizzati. Se il motore manca, la pagina presenta un blocco esplicito anziché un falso successo.

## Prerequisiti

1. Installa ComfyUI sulla **stessa macchina che esegue il backend ADAM**, ascoltando solo sull'interfaccia loopback:
   - Esempio: python main.py --listen 127.0.0.1 --port 8188
   - Verifica sul server: curl http://127.0.0.1:8188/system_stats
2. Installa nel motore ComfyUI modelli / custom nodes **compatibili con i tuoi workflow**. Per il video puoi usare un workflow con modello video locale (es. LTX-Video o Wan); per la musica un workflow audio locale compatibile (es. ACE-Step). Versioni, requisiti di GPU, nodi e licenze vanno verificati separatamente.
3. In ComfyUI apri e prova ciascun workflow con il suo modello, poi **esportalo in API format** (JSON graph con nodi class_type). Non usare il workflow UI di layout.
4. Prepara la directory (es. /opt/adam/workflows) contenente:
   - video-api.json
   - music-api.json
5. Usa questi segnaposto nelle proprietà inputs corrette dei nodi nel JSON export:
   - {{PROMPT}}: descrizione testuale
   - {{SECONDS}}: durata in secondi, numero intero
   - {{FRAMES}}: 12 * durata, numero intero (la frequenza effettiva va configurata nel workflow)
   - {{SEED}}: seed numerico casuale
   **Importante**: non tutti i modelli accettano i medesimi inputs. Cambia solo gli inputs del workflow *che hai già collaudato*. La funzione non inventa nodi né genera un workflow dal nulla.
6. Nel backend ADAM configura solo:
   - ADAM_COMFYUI_URL=http://127.0.0.1:8188/
   - ADAM_CREATIVE_WORKFLOW_DIR=/opt/adam/workflows
   Riavvia il backend.
7. Accedi con l'account ADAM, visita /creative, scegli Video AI o Musica AI, scrivi prompt, durata, invia richiesta; attendi lo stato e apri/scarica il risultato.

## Sicurezza / costi

- Richieste via tRPC **solo da utenti autenticati**, generazioni e download segregati per user ID.
- Il server accetta solo un motore ComfyUI configurato lato server su loopback, non URL forniti da utenti. **Non aprire porte sul router.**
- Massimo una generazione in corso per utente, due in totale, sei generazioni/ora/utente.
- I download vengono ritrasmessi attraverso il backend e limitati a 16 MiB; per output più grandi apri l'interfaccia ComfyUI direttamente **sulla macchina locale**, non esporla pubblicamente.
- I job sono in RAM e scadono dopo due ore; non sono persistenti, non sono adatti a cluster multi-processo / serverless. Non usare in produzione distribuita senza coda condivisa, storage con ACL e rate limit distribuito.
- ComfyUI e modelli locali non richiedono pagamento per ogni generazione, ma richiedono risorse proprie. Verifica **licenze dei pesi** e permessi commerciali prima di pubblicare audio/video.
- Questa funzione **non concede accesso a telefoni, filesystem remoti o Wi-Fi**. Per lavorare su un dispositivo diverso serve un ponte locale autenticato con verifica della rete autorizzata, mai un port forwarding anonimo.
- Nessuna configurazione di produzione, API key o dispositivo viene alterata da questo branch.

## Verifica manuale (obbligatoria prima di merge)

1. pnpm check && pnpm test
2. Senza env: /creative disabilita i pulsanti e spiega perché.
3. Con env ma senza ComfyUI: errore esplicito, nessun risultato inventato.
4. Con ComfyUI e i due workflow funzionanti: genera video e audio, verifica che il media sia riproducibile e scaricabile.
5. Utente A genera: utente B non può leggere status/download dell'id A.
6. Input prompt troppo lunghi/corti, durate invalide, workflow assenti, formato non supportato, output >16 MiB => errore coerente.
7. Spegnendo ComfyUI a metà job: l'interfaccia mostra non raggiungibile, non segna completato.
8. Riavviare ADAM durante un job: ID scaduto, esito non ripristinato — limite noto di questa versione.
9. Verificare la demo chatgpt.site separatamente: non risulta collegata automaticamente a questo repository.

## Riferimenti

- ComfyUI API: https://docs.comfy.org/development/comfyui-server/comms_routes
- ComfyUI: https://github.com/Comfy-Org/ComfyUI
- Modelli musica gratuiti spesso soggetti a vincoli di licenza: https://github.com/facebookresearch/audiocraft
