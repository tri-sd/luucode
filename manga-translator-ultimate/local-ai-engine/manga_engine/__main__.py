import uvicorn

from .api import PORT, app

uvicorn.run(app, host="127.0.0.1", port=PORT, proxy_headers=False, access_log=False,
            limit_concurrency=24, timeout_keep_alive=4)
