# Support Hub setup

1. Copy `.env.example` to `.env`.
2. Set `MONGODB_URI`, a strong `JWT_SECRET`, `VERIFY_TOKEN`, WhatsApp Cloud API credentials, and the ERP connection settings.
3. Set `ERP_SUPPORT_API_KEY` to the same private key configured in Battery ERP. `ERP_API_URL` should point to `http://localhost:5000/api/integration` for local development.
4. Run `npm install`, then `npm test`, then `npm start`.
5. Open `http://localhost:3000/health`.
6. Configure a public HTTPS URL ending in `/webhook` in Meta WhatsApp settings and subscribe to incoming messages. Localhost by itself cannot receive Meta webhooks.

Inbound proof documents are restricted to JPG, PNG and PDF under 10 MB and are stored outside the public static directory. Authenticated admins can open complaint proof documents from the admin dashboard.

`npm test` checks JavaScript syntax only. Real MongoDB, ERP and Meta WhatsApp integration must still be tested in the target environment.
