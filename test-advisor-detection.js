// Script de prueba para la detección de asesores
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Función para probar la detección de asesores
async function testAdvisorDetection() {
  console.log("🧪 Iniciando pruebas de detección de asesores...\n");

  // 1. Verificar que los asesores fueron creados
  console.log("1️⃣ Verificando asesores en la base de datos:");
  const { data: advisors, error: advisorsError } = await supabase
    .from('advisors')
    .select('*')
    .order('created_at', { ascending: true });

  if (advisorsError) {
    console.error("❌ Error obteniendo asesores:", advisorsError);
    return;
  }

  if (!advisors || advisors.length === 0) {
    console.error("❌ No se encontraron asesores. ¿Ejecutaste el script SQL?");
    return;
  }

  console.log(`✅ Encontrados ${advisors.length} asesores:`);
  advisors.forEach((advisor, index) => {
    console.log(`   ${index + 1}. ${advisor.name} - ${advisor.twilio_phone_number} (${advisor.is_active ? 'Activo' : 'Inactivo'})`);
  });

  // 2. Verificar estructura de tablas
  console.log("\n2️⃣ Verificando estructura de tablas:");
  
  try {
    // Verificar chat_history
    const { data: chatHistoryColumns } = await supabase
      .from('chat_history')
      .select('advisor_id')
      .limit(1);
    
    console.log("✅ Tabla chat_history tiene columna advisor_id");

    // Verificar messages
    const { data: messagesColumns } = await supabase
      .from('messages')
      .select('advisor_id')
      .limit(1);
    
    console.log("✅ Tabla messages tiene columna advisor_id");
  } catch (error) {
    console.error("❌ Error verificando estructura:", error.message);
  }

  // 3. Simular detección de asesor
  console.log("\n3️⃣ Simulando detección de asesor:");
  const testTwilioNumber = advisors[0]?.twilio_phone_number;
  
  if (testTwilioNumber) {
    const { data: foundAdvisor } = await supabase
      .from('advisors')
      .select('*')
      .eq('twilio_phone_number', testTwilioNumber)
      .eq('is_active', true)
      .single();

    if (foundAdvisor) {
      console.log(`✅ Asesor detectado correctamente:`);
      console.log(`   Número: ${testTwilioNumber}`);
      console.log(`   Asesor: ${foundAdvisor.name}`);
      console.log(`   ID: ${foundAdvisor.id}`);
    } else {
      console.log("❌ No se pudo detectar el asesor");
    }
  }

  console.log("\n🎉 ¡Pruebas completadas!");
  
  // 4. Mostrar configuración para el dashboard
  console.log("\n4️⃣ Configuración para el Dashboard:");
  console.log("Para usar el dashboard, asegúrate de enviar el advisorId en el body:");
  console.log("```json");
  console.log("{");
  console.log('  "clientNumber": "+57XXXXXXXXX",');
  console.log('  "newMessage": "Mensaje de prueba",');
  console.log('  "userName": "nombre_asesor",');
  console.log(`  "advisorId": "${advisors[0]?.id || 'UUID_DEL_ASESOR'}"`);
  console.log("}");
  console.log("```");
}

// Ejecutar las pruebas
testAdvisorDetection().catch(console.error);
