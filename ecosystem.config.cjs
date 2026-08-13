module.exports = {
  apps: [
    {
      name: "tzlh7",
      script: "dist/index.js",
      cwd: "/var/www/tzlh7",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3004,
        OAUTH_SERVER_URL: "https://api.manus.im",
      },
      max_memory_restart: "700M",
      autorestart: true,
      time: true,
    },
  ],
};
