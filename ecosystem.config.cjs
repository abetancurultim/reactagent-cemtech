module.exports = {
    apps: [
      {
        name: "cemtech-chatbot",
        script: "dist/index.js", // Asegúrate de que apunte al archivo compilado.
        instances: 1, // Cambia a "max" si quieres usar todos los núcleos de CPU.
        autorestart: true,
        watch: false, // Desactiva en producción.
        max_memory_restart: "500M",
        env: {
            NODE_ENV: "production",
            PORT: 3026,
        },
      },
    ],
};