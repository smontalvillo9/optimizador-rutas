// server.js - Backend completo para optimizador de rutas
// Optimizado para Railway deployment con PostgreSQL
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuración de PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Configuración de multer para upload de archivos
const upload = multer({ storage: multer.memoryStorage() });

// ==================== RUTAS API ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ==================== GESTIÓN DE FLOTA ====================

// Obtener todos los vehículos
app.get('/api/vehiculos', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.*, p.nombre as proveedor_nombre, tv.nombre as tipo_nombre
      FROM vehiculos v
      LEFT JOIN proveedores p ON v.proveedor_id = p.id
      LEFT JOIN tipos_vehiculo tv ON v.tipo_vehiculo_id = tv.id
      WHERE v.activo = true
      ORDER BY v.numero_camion
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    res.status(500).json({ error: 'Error al obtener vehículos' });
  }
});

// Obtener vehículos por proveedor
app.get('/api/proveedores/:id/vehiculos', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT v.*, tv.nombre as tipo_nombre
      FROM vehiculos v
      LEFT JOIN tipos_vehiculo tv ON v.tipo_vehiculo_id = tv.id
      WHERE v.proveedor_id = $1 AND v.activo = true
      ORDER BY v.numero_camion
    `, [id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vehicles by provider:', error);
    res.status(500).json({ error: 'Error al obtener vehículos del proveedor' });
  }
});

// Obtener todos los proveedores
app.get('/api/proveedores', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, 
             COUNT(v.id) as total_vehiculos,
             SUM(v.capacidad_combis) as capacidad_total
      FROM proveedores p
      LEFT JOIN vehiculos v ON p.id = v.proveedor_id AND v.activo = true
      WHERE p.activo = true
      GROUP BY p.id, p.nombre, p.almacen_base_id, p.activo
      ORDER BY p.nombre
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching providers:', error);
    res.status(500).json({ error: 'Error al obtener proveedores' });
  }
});

// Obtener tiendas por proveedor
app.get('/api/proveedores/:id/tiendas', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT t.*, tp.motivo as motivo_asignacion,
             h.dia_semana, h.hora_inicio, h.hora_fin, h.adaptable
      FROM tiendas t
      LEFT JOIN tienda_proveedores tp ON t.id = tp.tienda_id
      LEFT JOIN tienda_horarios h ON t.id = h.tienda_id
      WHERE tp.proveedor_id = $1
      ORDER BY t.codigo
    `, [id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching stores by provider:', error);
    res.status(500).json({ error: 'Error al obtener tiendas del proveedor' });
  }
});

// ==================== OPTIMIZACIÓN VRP ====================

// Algoritmo VRP básico (First Fit Decreasing)
function optimizarRutasBasico(tiendas, vehiculos) {
  // Ordenar tiendas por combis descendente
  const tiendasOrdenadas = [...tiendas].sort((a, b) => b.combis_promedio - a.combis_promedio);
  
  // Inicializar rutas
  const rutas = vehiculos.map(vehiculo => ({
    vehiculo_id: vehiculo.id,
    vehiculo_nombre: vehiculo.nombre_corto,
    capacidad_maxima: vehiculo.capacidad_combis,
    capacidad_usada: 0,
    tiendas: [],
    eficiencia: 0
  }));
  
  // Asignar tiendas a vehículos (First Fit Decreasing)
  tiendasOrdenadas.forEach(tienda => {
    for (let ruta of rutas) {
      if (ruta.capacidad_usada + tienda.combis_promedio <= ruta.capacidad_maxima) {
        ruta.tiendas.push(tienda);
        ruta.capacidad_usada += tienda.combis_promedio;
        ruta.eficiencia = (ruta.capacidad_usada / ruta.capacidad_maxima) * 100;
        break;
      }
    }
  });
  
  // Filtrar rutas vacías
  return rutas.filter(ruta => ruta.tiendas.length > 0);
}

// Calcular métricas de optimización
function calcularMetricas(rutas, totalTiendas) {
  const totalCapacidad = rutas.reduce((sum, ruta) => sum + ruta.capacidad_maxima, 0);
  const capacidadUsada = rutas.reduce((sum, ruta) => sum + ruta.capacidad_usada, 0);
  const tiendasAsignadas = rutas.reduce((sum, ruta) => sum + ruta.tiendas.length, 0);
  
  return {
    eficiencia_llenado: Math.round((capacidadUsada / totalCapacidad) * 100),
    vehiculos_necesarios: rutas.length,
    vehiculos_disponibles: rutas.length,
    tiendas_asignadas: tiendasAsignadas,
    tiendas_totales: totalTiendas,
    capacidad_total: totalCapacidad,
    capacidad_usada: Math.round(capacidadUsada * 10) / 10,
    ahorro_potencial: Math.max(0, rutas.length - Math.ceil(capacidadUsada / (totalCapacidad / rutas.length)))
  };
}

// Endpoint de optimización
app.post('/api/optimizar', async (req, res) => {
  try {
    const { proveedor_id } = req.body;
    
    // Obtener vehículos del proveedor
    const vehiculosResult = await pool.query(`
      SELECT id, numero_camion, nombre_corto, tipo_pago, capacidad_combis
      FROM vehiculos 
      WHERE proveedor_id = $1 AND activo = true
      ORDER BY capacidad_combis DESC
    `, [proveedor_id]);
    
    // Obtener tiendas del proveedor
    const tiendasResult = await pool.query(`
      SELECT t.id, t.codigo, t.nombre, t.combis_promedio, t.provincia
      FROM tiendas t
      LEFT JOIN tienda_proveedores tp ON t.id = tp.tienda_id
      WHERE tp.proveedor_id = $1
      ORDER BY t.combis_promedio DESC
    `, [proveedor_id]);
    
    const vehiculos = vehiculosResult.rows;
    const tiendas = tiendasResult.rows;
    
    if (!vehiculos.length || !tiendas.length) {
      return res.status(400).json({ 
        error: 'No se encontraron vehículos o tiendas para este proveedor' 
      });
    }
    
    // Ejecutar optimización
    const rutasOptimizadas = optimizarRutasBasico(tiendas, vehiculos);
    const metricas = calcularMetricas(rutasOptimizadas, tiendas.length);
    
    res.json({
      rutas: rutasOptimizadas,
      metricas: metricas,
      proveedor_id: proveedor_id,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error en optimización:', error);
    res.status(500).json({ error: 'Error en la optimización de rutas' });
  }
});

// ==================== GESTIÓN DE ESCENARIOS ====================

// Obtener escenarios
app.get('/api/escenarios', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, nombre, descripcion, configuracion, metricas, activo, created_at
      FROM escenarios
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching scenarios:', error);
    res.status(500).json({ error: 'Error al obtener escenarios' });
  }
});

// Crear escenario
app.post('/api/escenarios', async (req, res) => {
  try {
    const { nombre, descripcion, configuracion, metricas } = req.body;
    
    const result = await pool.query(`
      INSERT INTO escenarios (nombre, descripcion, configuracion, metricas, activo)
      VALUES ($1, $2, $3, $4, false)
      RETURNING *
    `, [nombre, descripcion, JSON.stringify(configuracion), JSON.stringify(metricas)]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating scenario:', error);
    res.status(500).json({ error: 'Error al crear escenario' });
  }
});

// Activar escenario
app.put('/api/escenarios/:id/activar', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Desactivar todos los escenarios
    await pool.query('UPDATE escenarios SET activo = false');
    
    // Activar el escenario seleccionado
    const result = await pool.query(`
      UPDATE escenarios SET activo = true WHERE id = $1 RETURNING *
    `, [id]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error activating scenario:', error);
    res.status(500).json({ error: 'Error al activar escenario' });
  }
});

// ==================== ADMINISTRACIÓN ====================

// ENDPOINT DE LIMPIEZA - Eliminar datos duplicados
app.post('/api/admin/limpiar-datos', async (req, res) => {
  try {
    console.log('🧹 Iniciando limpieza de datos...');
    
    // Eliminar relaciones primero (para evitar foreign key constraints)
    await pool.query('DELETE FROM tienda_proveedores');
    console.log('✅ Relaciones tienda-proveedor eliminadas');
    
    // Eliminar datos principales
    await pool.query('DELETE FROM vehiculos');
    await pool.query('DELETE FROM tiendas');
    await pool.query('DELETE FROM escenarios');
    await pool.query('DELETE FROM proveedores');
    await pool.query('DELETE FROM tipos_vehiculo');
    console.log('✅ Todos los datos eliminados');
    
    // Reinsertar datos limpios
    await insertarDatosPrueba();
    console.log('✅ Datos limpios insertados');
    
    res.json({ 
      message: 'Datos limpiados e insertados correctamente',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error limpiando datos:', error);
    res.status(500).json({ error: 'Error limpiando datos: ' + error.message });
  }
});

// ENDPOINT DE ESTADÍSTICAS - Para diagnóstico
app.get('/api/admin/estadisticas', async (req, res) => {
  try {
    const stats = {
      proveedores: await pool.query('SELECT COUNT(*) as total FROM proveedores'),
      vehiculos: await pool.query('SELECT COUNT(*) as total FROM vehiculos'),
      tiendas: await pool.query('SELECT COUNT(*) as total FROM tiendas'),
      relaciones: await pool.query('SELECT COUNT(*) as total FROM tienda_proveedores'),
      duplicados_proveedores: await pool.query(`
        SELECT nombre, COUNT(*) as duplicados 
        FROM proveedores 
        GROUP BY nombre 
        HAVING COUNT(*) > 1
      `)
    };
    
    res.json({
      total_proveedores: parseInt(stats.proveedores.rows[0].total),
      total_vehiculos: parseInt(stats.vehiculos.rows[0].total),
      total_tiendas: parseInt(stats.tiendas.rows[0].total),
      total_relaciones: parseInt(stats.relaciones.rows[0].total),
      proveedores_duplicados: stats.duplicados_proveedores.rows,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

// ==================== IMPORTACIÓN EXCEL ====================

// Importar datos de Excel
app.post('/api/import/excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó archivo' });
    }
    
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetNames = workbook.SheetNames;
    
    let resultados = {
      vehiculos_importados: 0,
      tiendas_importadas: 0,
      errores: []
    };
    
    // Procesar cada hoja del Excel
    for (let sheetName of sheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      
      // Lógica de importación basada en el nombre de la hoja
      if (sheetName.toLowerCase().includes('vehiculo') || sheetName.toLowerCase().includes('flota')) {
        // Importar vehículos
        for (let row of data) {
          try {
            // Mapear columnas del Excel a campos de la base de datos
            const vehiculo = {
              numero_camion: row['CAMION'] || row['numero'] || row['id'],
              nombre_corto: row['NOMBRE CORTO'] || row['proveedor'] || row['nombre'],
              tipo_pago: row['TIPO PAGO'] || row['tipo'] || 'DESCONOCIDO',
              capacidad_combis: parseInt(row['CAP CAM'] || row['capacidad'] || 0)
            };
            
            if (vehiculo.numero_camion && vehiculo.capacidad_combis > 0) {
              // Insertar vehículo (simplificado para demo)
              resultados.vehiculos_importados++;
            }
          } catch (error) {
            resultados.errores.push(`Error en vehículo ${row['CAMION']}: ${error.message}`);
          }
        }
      }
    }
    
    res.json(resultados);
    
  } catch (error) {
    console.error('Error importing Excel:', error);
    res.status(500).json({ error: 'Error al importar archivo Excel' });
  }
});

// ==================== INICIALIZACIÓN ====================

// Crear tablas básicas si no existen (para demo)
async function initializeDatabase() {
  try {
    // Verificar conexión primero
    await pool.query('SELECT NOW()');
    console.log('✅ Conexión a PostgreSQL exitosa');
    
    // Crear tabla de proveedores
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proveedores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre VARCHAR(255) NOT NULL,
        almacen_base_id UUID,
        activo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Crear tabla de tipos de vehículo
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tipos_vehiculo (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre VARCHAR(50) UNIQUE NOT NULL
      )
    `);
    
    // Crear tabla de vehículos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehiculos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        numero_camion INTEGER UNIQUE NOT NULL,
        proveedor_id UUID REFERENCES proveedores(id),
        nombre_corto VARCHAR(100),
        tipo_pago VARCHAR(50),
        tipo_vehiculo_id UUID REFERENCES tipos_vehiculo(id),
        capacidad_combis INTEGER NOT NULL,
        activo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Crear tabla de tiendas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tiendas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        codigo VARCHAR(20) UNIQUE NOT NULL,
        nombre VARCHAR(255) NOT NULL,
        direccion TEXT,
        provincia VARCHAR(100),
        combis_promedio DECIMAL(5,2),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Crear tabla de escenarios
    await pool.query(`
      CREATE TABLE IF NOT EXISTS escenarios (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre VARCHAR(255) NOT NULL,
        descripcion TEXT,
        configuracion JSONB DEFAULT '{}',
        metricas JSONB DEFAULT '{}',
        activo BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    console.log('✅ Base de datos inicializada correctamente');
    
    // Insertar datos de prueba si no existen
    await insertarDatosPrueba();
    
  } catch (error) {
    console.error('⚠️ Error inicializando base de datos:', error.message);
    console.log('🔄 Servidor continuará sin base de datos (modo demo)');
  }
}

// Insertar datos de prueba basados en tu flota real
async function insertarDatosPrueba() {
  try {
    // Verificar si ya existen datos
    const existingProviders = await pool.query('SELECT COUNT(*) FROM proveedores');
    if (parseInt(existingProviders.rows[0].count) > 0) {
      // Verificar si ya hay vehículos
      const existingVehicles = await pool.query('SELECT COUNT(*) FROM vehiculos');
      if (parseInt(existingVehicles.rows[0].count) > 0) {
        console.log('✅ Datos de prueba ya existen');
        return;
      }
    }
    
    // Insertar proveedores principales
    const proveedores = [
      'TTES BARA', 'GERMANS SARDA', 'IBARZO', 'TESO', 
      'TRANSMEDALLO', 'SANTIAGO LOZANO', 'TTES AGUSTIN', 
      'TTES RODRIGUEZ', 'DRA', 'TRANSMEDITERRANEA'
    ];
    
    for (let proveedor of proveedores) {
      await pool.query(
        'INSERT INTO proveedores (nombre) VALUES ($1) ON CONFLICT DO NOTHING',
        [proveedor]
      );
    }
    
    // Insertar tipos de vehículo
    const tipos = [
      '3.5 TONELADAS', '7.5 TONELADAS', '12 TONELADAS', '18 TONELADAS',
      'TREN DE CARRETERA', 'DOBLE PISO', 'TRAILER'
    ];
    
    for (let tipo of tipos) {
      await pool.query(
        'INSERT INTO tipos_vehiculo (nombre) VALUES ($1) ON CONFLICT DO NOTHING',
        [tipo]
      );
    }
    
    // Obtener IDs de proveedores y tipos
    const proveedoresIds = await pool.query('SELECT id, nombre FROM proveedores');
    const tiposIds = await pool.query('SELECT id, nombre FROM tipos_vehiculo');
    
    const proveedorMap = {};
    proveedoresIds.rows.forEach(p => proveedorMap[p.nombre] = p.id);
    
    const tipoMap = {};
    tiposIds.rows.forEach(t => tipoMap[t.nombre] = t.id);
    
    // Insertar vehículos basados en tu flota real exacta
    const vehiculos = [
      // TTES BARA - 5 vehículos exactos
      { numero: 7, proveedor: 'TTES BARA', nombre: 'TTES BARA - 007', tipo: 'TREN DE CARRETERA', capacidad: 63 },
      { numero: 8, proveedor: 'TTES BARA', nombre: 'TTES BARA - 008', tipo: 'TREN DE CARRETERA', capacidad: 63 },
      { numero: 13, proveedor: 'TTES BARA', nombre: 'TTES BARA - 013', tipo: '18 TONELADAS', capacidad: 30 },
      { numero: 14, proveedor: 'TTES BARA', nombre: 'TTES BARA - 014', tipo: '18 TONELADAS', capacidad: 30 },
      { numero: 20, proveedor: 'TTES BARA', nombre: 'TTES BARA - 020', tipo: '7.5 TONELADAS', capacidad: 17 },
      
      // GERMANS SARDA - según tu Excel
      { numero: 2, proveedor: 'GERMANS SARDA', nombre: 'GERMANS SARDA - 002', tipo: 'TREN DE CARRETERA', capacidad: 63 },
      { numero: 3, proveedor: 'GERMANS SARDA', nombre: 'GERMANS SARDA - 003', tipo: 'TREN DE CARRETERA', capacidad: 63 },
      { numero: 4, proveedor: 'GERMANS SARDA', nombre: 'GERMANS SARDA - 004', tipo: 'TREN DE CARRETERA', capacidad: 63 },
      { numero: 5, proveedor: 'GERMANS SARDA', nombre: 'GERMANS SARDA - 005', tipo: 'TREN DE CARRETERA', capacidad: 63 },
      { numero: 6, proveedor: 'GERMANS SARDA', nombre: 'GERMANS SARDA - 006', tipo: 'TREN DE CARRETERA', capacidad: 63 },
      
      // IBARZO - según tu Excel  
      { numero: 30, proveedor: 'IBARZO', nombre: 'IBARZO - 030', tipo: 'TREN DE CARRETERA', capacidad: 63 },
      
      // TESO - según tu Excel
      { numero: 9, proveedor: 'TESO', nombre: 'TESO - 009', tipo: 'TREN DE CARRETERA', capacidad: 60 },
      { numero: 11, proveedor: 'TESO', nombre: 'TESO - 011', tipo: '18 TONELADAS', capacidad: 48 },
      { numero: 12, proveedor: 'TESO', nombre: 'TESO - 012', tipo: '18 TONELADAS', capacidad: 30 },
      { numero: 16, proveedor: 'TESO', nombre: 'TESO - 016', tipo: '12 TONELADAS', capacidad: 24 }
    ];
    
    for (let vehiculo of vehiculos) {
      const proveedorId = proveedorMap[vehiculo.proveedor];
      const tipoId = tipoMap[vehiculo.tipo];
      
      if (proveedorId && tipoId) {
        await pool.query(`
          INSERT INTO vehiculos (numero_camion, proveedor_id, nombre_corto, tipo_pago, tipo_vehiculo_id, capacidad_combis)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (numero_camion) DO NOTHING
        `, [vehiculo.numero, proveedorId, vehiculo.nombre, 'por_combi', tipoId, vehiculo.capacidad]);
      }
    }
    
    // Insertar algunas tiendas de prueba
    const tiendas = [
      { codigo: '60318', nombre: 'Artés', provincia: 'BARCELONA', combis: 5.2 },
      { codigo: '60445', nombre: 'Cervelló', provincia: 'BARCELONA', combis: 8.1 },
      { codigo: '60446', nombre: 'Corbera de Llobregat', provincia: 'BARCELONA', combis: 6.3 },
      { codigo: '60481', nombre: 'Manresa', provincia: 'BARCELONA', combis: 7.8 },
      { codigo: '60485', nombre: 'Polinyà', provincia: 'BARCELONA', combis: 4.9 },
      { codigo: '60489', nombre: 'Ripollet', provincia: 'BARCELONA', combis: 5.7 },
      { codigo: '60078', nombre: 'María de Huerva', provincia: 'ZARAGOZA', combis: 6.2 },
      { codigo: '60084', nombre: 'Quinto', provincia: 'ZARAGOZA', combis: 4.1 },
      { codigo: '60093', nombre: 'Zaragoza', provincia: 'ZARAGOZA', combis: 12.3 }
    ];
    
    for (let tienda of tiendas) {
      await pool.query(`
        INSERT INTO tiendas (codigo, nombre, provincia, combis_promedio)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (codigo) DO NOTHING
      `, [tienda.codigo, tienda.nombre, tienda.provincia, tienda.combis]);
    }
    
    // Crear tabla de relación tienda-proveedor si no existe
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tienda_proveedores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tienda_id UUID REFERENCES tiendas(id),
        proveedor_id UUID REFERENCES proveedores(id),
        motivo VARCHAR(255)
      )
    `);
    
    // Asignar tiendas a proveedores
    const asignaciones = [
      { proveedor: 'TTES BARA', tiendas: ['60318', '60445', '60446', '60481'] },
      { proveedor: 'GERMANS SARDA', tiendas: ['60485', '60489'] },
      { proveedor: 'IBARZO', tiendas: ['60078', '60084', '60093'] }
    ];
    
    for (let asignacion of asignaciones) {
      const proveedorId = proveedorMap[asignacion.proveedor];
      
      for (let codigoTienda of asignacion.tiendas) {
        const tiendaResult = await pool.query('SELECT id FROM tiendas WHERE codigo = $1', [codigoTienda]);
        if (tiendaResult.rows.length > 0) {
          const tiendaId = tiendaResult.rows[0].id;
          await pool.query(`
            INSERT INTO tienda_proveedores (tienda_id, proveedor_id, motivo)
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING
          `, [tiendaId, proveedorId, 'Asignación de prueba']);
        }
      }
    }
    
    console.log('✅ Datos de prueba insertados - Vehículos y tiendas añadidos');
    
  } catch (error) {
    console.error('Error insertando datos de prueba:', error);
  }
}

// ==================== INICIAR SERVIDOR ====================

async function startServer() {
  try {
    await initializeDatabase();
    
    app.listen(port, () => {
      console.log(`🚀 Servidor corriendo en puerto ${port}`);
      console.log(`🗄️ Base de datos: ${process.env.DATABASE_URL ? 'PostgreSQL conectado' : 'PostgreSQL local'}`);
      console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 URL: http://localhost:${port}`);
    });
  } catch (error) {
    console.error('❌ Error iniciando servidor:', error);
    process.exit(1);
  }
}

startServer();