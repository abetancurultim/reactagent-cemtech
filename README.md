# Cemtech AI Estimator Agent 🏗️🤖

Este proyecto es un **Agente de Inteligencia Artificial para WhatsApp** diseñado para **Cemtech Enterprise Inc.** Su función principal es actuar como un "Estimador Senior", asistiendo a los representantes de ventas en la creación de cotizaciones de construcción (concreto, demolición, etc.) de manera conversacional, rápida y precisa.

El sistema utiliza **LangChain**, **OpenAI (GPT-4.1)**, **Supabase** (Base de datos), **Firebase** (Almacenamiento) y **Twilio** (WhatsApp).

---

## 🚀 Características Principales

*   **Estimación Inteligente:** Desglosa solicitudes vagas (ej: "Necesito una acera") en partidas detalladas (Concreto, Malla, Mano de obra, etc.).
*   **Generación de PDF:** Crea documentos PDF formales con el logo de la empresa y desglose de costos, subiéndolos a Firebase.
*   **Arquitectura Multi-Asesor:** Soporta múltiples agentes humanos simultáneos, cada uno con su propio número de WhatsApp y memoria de IA independiente.
*   **Manejo de Audio:**
    *   **STT (Speech-to-Text):** Transcribe audios recibidos usando OpenAI Whisper.
    *   **TTS (Text-to-Speech):** Responde con notas de voz usando ElevenLabs si la respuesta es corta y concisa.
*   **Persistencia:** Guarda todo el historial de chat y el estado de las cotizaciones en Supabase.

---

## 🧠 Flujo del Agente (The Estimation Recipe)

El núcleo del proyecto reside en `src/agents/mainAgent.ts` y `src/config/constants.ts`. El agente no es un simple chatbot; sigue un **flujo estricto de razonamiento** para generar cotizaciones válidas.

### 1. Recepción y Enrutamiento (`src/routes/chatRoutes.ts`)
1.  El webhook recibe un mensaje de Twilio.
2.  **Detección de Asesor:** Identifica a qué asesor pertenece el número de destino (`To`) consultando la tabla `advisors`.
3.  **Aislamiento:** Configura un `thread_id` único compuesto por `advisor_id + client_number` para aislar la memoria.
4.  **Transcrpción (si es audio):** Si el mensaje es audio, se transcribe a texto.

### 2. Razonamiento del Agente (`src/agents/mainAgent.ts`)
El agente recibe el mensaje y el historial. Basado en el `SYSTEM_PROMPT`, sigue estos pasos lógicos:

1.  **Identificación:** Solicita el **Nombre del Cliente** y **Email** si no los tiene.
2.  **Creación de Cotización (`create_quote`):** Genera un registro en la base de datos con estado `draft`.
3.  **Estructuración Jerárquica (Padre/Hijo):**
    *   **Paso A (Job):** Crea una partida "Padre" (ej: "Driveway Replacement") usando `add_line_item` sin `parent_id`.
    *   **Paso B (Recursos):** Busca precios en el catálogo (`search_catalog`) y agrega los materiales/mano de obra como "Hijos" vinculados al ID del Padre.
4.  **Revisión:** Usa `get_quote_details` para verificar los totales calculados.
5.  **Negociación:** Si el usuario pide cambios de precio, usa `negotiate_price` para alterar una línea específica sin tocar el catálogo maestro.
6.  **Finalización:** Cuando el usuario aprueba, ejecuta `generate_pdf`.

### 3. Herramientas Disponibles (`src/tools/tools.ts`)

El agente tiene acceso exclusivo a estas funciones:

| Herramienta | Descripción |
| :--- | :--- |
| `search_catalog` | Busca items y precios base en la tabla maestra `items_catalog`. |
| `create_quote` | Inicializa una nueva cotización vacía. Retorna el `quote_id`. |
| `add_line_item` | Agrega una línea. Puede ser un **Trabajo (Padre)** o un **Recurso (Hijo)**. |
| `get_quote_details` | Obtiene el desglose completo y jerárquico de la cotización actual. |
| `negotiate_price` | Modifica el precio unitario de una línea específica. |
| `update_line_item` | Actualiza cantidad, descripción o alcance de una línea. |
| `delete_line_item` | Elimina una línea (y sus hijos si es padre). |
| `generate_pdf` | Genera el PDF físico, lo sube a Firebase y devuelve la URL pública. |

---

## 🛠️ Configuración y Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto con las siguientes variables. **Todas son obligatorias** para el funcionamiento completo.

### Servidor y Base de Datos
```env
PORT=3031
NODE_ENV=development

# Supabase (PostgreSQL)
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_KEY=tu-service-role-key
CHAT_HISTORY_TABLE=chat_history
MESSAGES_TABLE=messages
```

### Inteligencia Artificial
```env
# OpenAI (Cerebro del agente y Transcripción)
OPENAI_API_KEY=sk-...

# ElevenLabs (Generación de voz)
ELEVENLABS_API_KEY=...
```

### Twilio (WhatsApp)
```env
# Credenciales principales
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
```

### Firebase (Almacenamiento de PDFs y Audios)
```env
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=...
FIREBASE_PROJECT_ID=...
FIREBASE_STORAGE_BUCKET=...
FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_APP_ID=...
```

---

## 📂 Estructura del Proyecto

```
src/
├── agents/
│   └── mainAgent.ts       # Configuración del Agente LangChain y Prompt del Sistema
├── config/
│   ├── constants.ts       # Prompts, constantes y "Receta" de estimación
│   ├── firebase.ts        # Inicialización de Firebase
│   └── tables.ts          # Nombres de tablas en Supabase
├── routes/
│   └── chatRoutes.ts      # Webhook principal, lógica de Twilio y orquestación
├── tools/
│   └── tools.ts           # Definición de herramientas (Zod schemas + Lógica)
├── types/
│   └── db.ts              # Interfaces TypeScript de la base de datos
├── utils/
│   ├── pdfGenerator.ts    # Lógica de generación de PDF con pdfmake
│   ├── saveHistoryDb.ts   # Funciones para guardar chats en Supabase
│   └── ...                # Otros utilitarios (delay, campaignDetector, etc.)
└── index.ts               # Punto de entrada del servidor Express
```

---

## 💾 Esquema de Base de Datos (Supabase)

El sistema depende de las siguientes tablas relacionales:

1.  **`advisors`**: Almacena la información de los agentes humanos (Nombre, Teléfono Twilio).
2.  **`items_catalog`**: Catálogo maestro de precios (Solo lectura para el agente).
3.  **`quotes`**: Cabecera de las cotizaciones (Cliente, Proyecto, Estado, URL PDF).
4.  **`quote_lines`**: Líneas de la cotización. Soporta jerarquía mediante `parent_line_id`.
5.  **`chat_history`**: Historial de conversaciones para contexto.
6.  **`messages`**: Registro de todos los mensajes. Se vinculan a una conversación.

---

## ▶️ Ejecución

### Desarrollo
```bash
npm install
npm run dev
```

### Producción
El proyecto incluye configuración para **PM2**:
```bash
npm run build
pm2 start ecosystem.config.cjs
```

---

## 🔍 Notas Importantes sobre la Lógica

1.  **Jerarquía de Costos:** El agente está instruido para **nunca** dar un precio suelto. Siempre debe agrupar materiales bajo un "Trabajo Padre".
2.  **Items Faltantes:** Si un item no existe en el catálogo, el agente tiene permiso para crear un item personalizado ("Custom Line Item") basado en su conocimiento general, dejando el `item_catalog_id` en `null`.
3.  **Seguridad:** El agente no puede modificar el `items_catalog`. Solo puede modificar los precios dentro de la tabla `quote_lines` de la cotización activa.
