# Scanner template

Copy this folder to `scanners/<id>/`, change `manifest.json`, then:

```bash
python3 -m scanners register --id <id>
```

The next `GET /bridge/scanners` / `POST /bridge/scan` will include it. Do not
edit `server.mjs`. `auth_ref` is an environment-variable **name** only.
