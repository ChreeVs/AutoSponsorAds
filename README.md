# AutoSponsorAds ⚡

Piattaforma avanzata per la **sponsorizzazione automatica e manuale in bulk** dei post Facebook e Instagram su Meta Ads.

Progettata per funzionare a **costo zero** sul piano gratuito di **Render.com** (o su qualsiasi server Node.js locale/cloud).

---

## 🚀 Nuove Funzionalità

1. **Motore di Automazione (Auto-Pilot):**
   - Monitoraggio continuo di profili Instagram e pagine Facebook.
   - Rilevamento automatico dei nuovi post/reel pubblicati.
   - Creazione autonoma di AdCreative e Ad nella campagna/gruppo inserzioni configurati.
   - Applicazione automatica delle regole Meta (`adrules_library`) con aggiunta del nuovo `ad.id`.
   - Prevenzione duplicati (idempotenza): nessun post viene sponsorizzato due volte.
   - Frequenza di controllo personalizzabile (ogni 6h, 12h, 24h).
   - Filtro opzionale basato su hashtag o parole chiave (es. solo post con `#sponsor` o `#promo`).
   - Naming pattern dinamico con token: `{platform}`, `{post}`, `{date}`, `{id}`.

2. **Supporto Nativo per Render.com Free Tier:**
   - **Superamento dello Sleep:** Endpoint protetto `POST /api/cron/check-and-sponsor` azionabile tramite cron esterno gratuito (es. *cron-job.org* o *GitHub Actions*) per risvegliare il container solo quando necessario senza consumare risorse.
   - **Database Ibrido:**
     - In **locale**: funziona subito out-of-the-box con SQLite locale (`node:sqlite` in `data/autosponsor.db`, zero configurazioni richieste).
     - In **produzione** (Render/Cloud): si collega istantaneamente a un database PostgreSQL esterno persistente (es. **Neon.tech** o **Supabase** a costo zero) tramite `DATABASE_URL`.

3. **Dashboard Web Moderna:**
   - **⚡ Automazioni:** visualizzazione a schede, switch attiva/disattiva, pulsante *"Esegui Ora"*, creazione guidata con modale.
   - **📅 Timeline Flow (con Pubblie.io):** previsione dei post programmati in uscita, selezione/deselezione dei contenuti per creare il flow di sponsorizzazione desiderato e associazione una tantum dei parametri Meta.
   - **📦 Sponsor Manuale:** l'esperienza bulk del tool originale preservata e potenziata.
   - **📋 Storico & Log:** audit trail completo di ogni controllo periodico e post sponsorizzato.
   - **⚙️ Setup Render:** diagnostica in tempo reale della connessione Meta e istruzioni di deploy.

4. **🔮 Integrazione Pubblie.io:**
   - Collegamento nativo con le API pubbliche di [Pubblie.io](https://pubblie.io) tramite Personal API Key.
   - Sincronizzazione automatica dei progetti, canali social e post schedulati per i prossimi 7, 14, 30 o 60 giorni.
   - Mappatura salvata una tantum: associa ogni canale Pubblie all'Account Meta, Campagna, AdSet e Regola desiderati.
   - Il motore di automazione rispetta rigorosamente le decisioni prese sulla timeline: se un post è marcato come "Escluso", non verrà sponsorizzato all'uscita.

---

## 🛠️ Requisiti

- **Node.js 22 o superiore** (raccomandato Node 22/24).
- Meta App con accesso alla Marketing API e un Access Token valido (`ads_management`, `pages_read_engagement`, `business_management`).

---

## 💻 Setup Locale

1. Copia `.env.example` in `.env`:
   ```bash
   cp .env.example .env
   ```
2. Inserisci in `.env` il tuo `META_ACCESS_TOKEN` (e opzionalmente `META_APP_ID`, `META_APP_SECRET`).
3. Avvia l'applicazione:
   ```bash
   npm start
   ```
4. Apri nel browser:
   ```text
   http://localhost:4173
   ```
*(In locale non serve configurare alcun database: verrà creato automaticamente `data/autosponsor.db`)*.

---

## ☁️ Deploy su Render.com (Piano Gratuito a 0€/mese)

### 1. Database Gratuito Persistente (Neon.tech o Supabase)
Poiché il disco del piano gratuito di Render viene resettato ad ogni riavvio:
1. Crea un account gratuito su [Neon.tech](https://neon.tech) o [Supabase](https://supabase.com).
2. Crea un database PostgreSQL gratuito e copia la stringa di connessione:
   `postgresql://utente:password@ep-xyz.neon.tech/neondb?sslmode=require`

### 2. Creazione Web Service su Render
1. Collega il tuo repository GitHub a Render.com.
2. Crea un **New Web Service**:
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** `Free`
3. Nelle **Environment Variables** di Render imposta:
   - `NODE_VERSION`: `22.12.0`
   - `META_ACCESS_TOKEN`: *(il tuo token Meta a lunga scadenza o System User Token)*
   - `DATABASE_URL`: *(la stringa di connessione PostgreSQL di Neon/Supabase)*
   - `CRON_SECRET`: *(una stringa casuale a tua scelta per proteggere il webhook)*

### 3. Schedulazione Automatica Esterna (per risvegliare Render)
Per fare in modo che il controllo avvenga regolarmente anche quando Render va in standby:
1. Registrati su [cron-job.org](https://cron-job.org) (completamente gratuito).
2. Crea un nuovo Cron Job:
   - **URL:** `https://tua-app.onrender.com/api/cron/check-and-sponsor`
   - **Schedule:** Ogni 12 ore (es. alle 09:00 e alle 21:00) o ogni 6 ore.
   - **Headers:** Aggiungi l'header HTTP:
     ```text
     Authorization: Bearer IL_TUO_CRON_SECRET
     ```
3. Fatto! Il cron risveglierà Render, l'applicazione controllerà i nuovi contenuti, creerà le inserzioni su Meta e il server tornerà in standby risparmiando ore e risorse.

---

## 📡 API Endpoints

| Metodo | Endpoint | Descrizione |
| :--- | :--- | :--- |
| `GET` | `/api/status` | Stato del sistema, tipo DB, salute del token Meta e uptime. |
| `GET` | `/api/automations` | Elenco di tutte le regole di automazione. |
| `POST` | `/api/automations` | Crea una nuova regola di automazione. |
| `PUT` | `/api/automations/:id` | Aggiorna una regola esistente. |
| `DELETE` | `/api/automations/:id` | Elimina una regola. |
| `POST` | `/api/automations/:id/toggle` | Attiva o disattiva una regola. |
| `POST` | `/api/automations/:id/run` | Esegue immediatamente il controllo per una specifica regola. |
| `POST` | `/api/automations/run-all` | Esegue il controllo manuale su tutte le regole attive. |
| `POST` | `/api/cron/check-and-sponsor` | Webhook di trigger per schedulatori esterni (`Authorization: Bearer <CRON_SECRET>`). |
| `GET` | `/api/logs` | Storico delle esecuzioni del bot. |
| `GET` | `/api/processed-posts` | Elenco dei post già sponsorizzati e loro Ad ID associati. |
| `POST` | `/api/meta/create-ads` | Creazione manuale inserzioni in bulk (funzionalità manuale). |
