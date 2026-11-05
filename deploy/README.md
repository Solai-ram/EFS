# First deploy on the VPS

Needs: Docker with the compose plugin, host nginx, certbot, and DNS for `efs.mapims.edu.in`.

```bash
git clone https://github.com/Solai-ram/EFS.git mapims-efs && cd mapims-efs
bash deploy/first-deploy.sh
```

The script checks ports 1010 / 2010 / 3010 are free, creates `backend/.env` with a random `JWT_SECRET` and random
Admin and Super Admin passwords (asks for the OpenRouter and Sarvam keys), builds and starts the stack, loads the
departments and both accounts, and checks the site answers. Re-running it is safe: it keeps your `.env` and users.

Then, as root: copy `nginx/efs.mapims.edu.in.conf` into nginx, reload, and run
`certbot --nginx -d efs.mapims.edu.in` (the microphone and offline mode need HTTPS).

## Day to day
- Update: `git pull && docker compose up -d --build`
- Logs: `docker compose logs -f backend`
- Backup the database: `docker compose exec -T mongodb mongodump --archive --gzip > efs-$(date +%F).gz`
- Recordings live in the `mapims_efs_uploads_data` volume; back it up too.
- Do not run `npm run seed-mock`, `seed-demo` or `reset-db` on the server: they wipe or fill the database with demo data.
