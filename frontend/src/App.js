import React, { useState, useEffect } from 'react';

// URL del backend API
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const App = () => {
  // Estados principales
  const [activeView, setActiveView] = useState('dashboard');
  const [proveedores, setProveedores] = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [selectedProveedor, setSelectedProveedor] = useState(null);
  const [optimizationResult, setOptimizationResult] = useState(null);
  const [escenarios, setEscenarios] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Estados para upload de archivos
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);

  // Cargar datos iniciales
  useEffect(() => {
    loadProveedores();
    loadVehiculos();
    loadEscenarios();
  }, []);

  // Funciones de API
  const apiCall = async (endpoint, options = {}) => {
    try {
      const response = await fetch(`${API_URL}/api${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('API Error:', error);
      setError(error.message);
      throw error;
    }
  };

  const loadProveedores = async () => {
    try {
      setLoading(true);
      const data = await apiCall('/proveedores');
      setProveedores(data);
    } catch (error) {
      console.error('Error loading providers:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadVehiculos = async () => {
    try {
      const data = await apiCall('/vehiculos');
      setVehiculos(data);
    } catch (error) {
      console.error('Error loading vehicles:', error);
    }
  };

  const loadEscenarios = async () => {
    try {
      const data = await apiCall('/escenarios');
      setEscenarios(data);
    } catch (error) {
      console.error('Error loading scenarios:', error);
    }
  };

  const optimizarRutas = async (proveedorId) => {
    try {
      setLoading(true);
      const result = await apiCall('/optimizar', {
        method: 'POST',
        body: JSON.stringify({ proveedor_id: proveedorId }),
      });
      setOptimizationResult(result);
    } catch (error) {
      console.error('Error optimizing routes:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async () => {
    if (!uploadFile) return;

    try {
      setLoading(true);
      const formData = new FormData();
      formData.append('file', uploadFile);

      const response = await fetch(`${API_URL}/api/import/excel`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      setUploadResult(result);
      
      // Recargar datos después de la importación
      await loadVehiculos();
      await loadProveedores();
    } catch (error) {
      console.error('Error uploading file:', error);
    } finally {
      setLoading(false);
    }
  };

  // Componentes de UI
  const LoadingSpinner = () => (
    <div className="flex items-center justify-center p-8">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      <span className="ml-2 text-gray-600">Cargando...</span>
    </div>
  );

  const ErrorAlert = ({ message, onClose }) => (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center">
          <div className="text-red-600 mr-2">⚠️</div>
          <span className="text-red-800">{message}</span>
        </div>
        <button 
          onClick={onClose}
          className="text-red-600 hover:text-red-800"
        >
          ✕
        </button>
      </div>
    </div>
  );

  const ProveedorCard = ({ proveedor, onClick, isSelected }) => (
    <div 
      className={`p-4 border rounded-lg cursor-pointer transition-all ${
        isSelected 
          ? 'border-blue-500 bg-blue-50 shadow-md' 
          : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
      }`}
      onClick={() => onClick(proveedor)}
    >
      <div className="font-semibold text-gray-900">{proveedor.nombre}</div>
      <div className="text-sm text-gray-600 mt-1">
        {Number(proveedor.total_vehiculos || 0)} vehículos • {Number(proveedor.capacidad_total || 0)} combis
      </div>
    </div>
  );

  const VehiculosList = ({ vehiculos, proveedorFilter = null }) => {
    const vehiculosFiltrados = proveedorFilter 
      ? vehiculos.filter(v => v.proveedor_nombre === proveedorFilter)
      : vehiculos;

    return (
      <div className="grid gap-3">
        {vehiculosFiltrados.map(vehiculo => (
          <div key={vehiculo.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
            <div>
              <span className="font-medium">Camión {vehiculo.numero_camion}</span>
              <span className="text-gray-600 ml-2">• {vehiculo.proveedor_nombre}</span>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium">{Number(vehiculo.capacidad_combis || 0)} combis</div>
              <div className="text-xs text-gray-500">{vehiculo.tipo_nombre}</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const OptimizationResults = ({ result }) => {
    if (!result) return null;

    return (
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="font-semibold text-lg mb-4">📊 Resultados de Optimización</h3>
        
        {/* Métricas generales */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="text-center p-3 bg-blue-50 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{Number(result.metricas?.eficiencia_llenado || 0)}%</div>
            <div className="text-xs text-gray-600">Eficiencia</div>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{Number(result.metricas?.vehiculos_necesarios || 0)}</div>
            <div className="text-xs text-gray-600">Vehículos</div>
          </div>
          <div className="text-center p-3 bg-yellow-50 rounded-lg">
            <div className="text-2xl font-bold text-yellow-600">{Number(result.metricas?.tiendas_asignadas || 0)}</div>
            <div className="text-xs text-gray-600">Tiendas</div>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg">
            <div className="text-2xl font-bold text-purple-600">{Number(result.metricas?.capacidad_usada || 0).toFixed(1)}</div>
            <div className="text-xs text-gray-600">Combis Usados</div>
          </div>
        </div>

        {/* Rutas detalladas */}
        <div className="space-y-4">
          <h4 className="font-medium text-gray-900">🚛 Rutas Optimizadas</h4>
          {result.rutas && result.rutas.map((ruta, index) => (
            <div key={index} className="border border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <h5 className="font-medium">{ruta.vehiculo_nombre || 'Vehículo'}</h5>
                <div className="text-sm text-gray-600">
                  {Number(ruta.eficiencia || 0).toFixed(1)}% llenado
                </div>
              </div>
              
              <div className="mb-2">
                <div className="flex justify-between text-sm mb-1">
                  <span>{Number(ruta.capacidad_usada || 0).toFixed(1)} combis</span>
                  <span>{Number(ruta.capacidad_maxima || 0)} combis máx</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, Number(ruta.eficiencia || 0))}%` }}
                  ></div>
                </div>
              </div>

              <div className="text-sm text-gray-600">
                <strong>Tiendas ({(ruta.tiendas || []).length}):</strong> {' '}
                {(ruta.tiendas || []).slice(0, 3).map(t => t.nombre || t.codigo).join(', ')}
                {(ruta.tiendas || []).length > 3 && ` y ${(ruta.tiendas || []).length - 3} más...`}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Render principal
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">🚛 TMS Optimizador de Rutas</h1>
              <p className="text-gray-600">Sistema de gestión y optimización de flota</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setActiveView('dashboard')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  activeView === 'dashboard'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                📊 Dashboard
              </button>
              <button
                onClick={() => setActiveView('optimization')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  activeView === 'optimization'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                ⚡ Optimización
              </button>
              <button
                onClick={() => setActiveView('import')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  activeView === 'import'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                📁 Importar
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Contenido principal */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && <ErrorAlert message={error} onClose={() => setError(null)} />}
        
        {activeView === 'dashboard' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h2 className="text-xl font-semibold mb-4">📈 Resumen de Flota</h2>
              
              {loading ? <LoadingSpinner /> : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="text-center p-4 bg-blue-50 rounded-lg">
                    <div className="text-3xl font-bold text-blue-600">{vehiculos.length}</div>
                    <div className="text-gray-600">Total Vehículos</div>
                  </div>
                  <div className="text-center p-4 bg-green-50 rounded-lg">
                    <div className="text-3xl font-bold text-green-600">{proveedores.length}</div>
                    <div className="text-gray-600">Proveedores</div>
                  </div>
                  <div className="text-center p-4 bg-yellow-50 rounded-lg">
                    <div className="text-3xl font-bold text-yellow-600">
                      {vehiculos.reduce((sum, v) => sum + Number(v.capacidad_combis || 0), 0)}
                    </div>
                    <div className="text-gray-600">Capacidad Total (combis)</div>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h3 className="font-semibold text-lg mb-4">🏢 Proveedores</h3>
                {loading ? <LoadingSpinner /> : (
                  <div className="space-y-3">
                    {proveedores.map(proveedor => (
                      <ProveedorCard 
                        key={proveedor.id} 
                        proveedor={proveedor}
                        onClick={setSelectedProveedor}
                        isSelected={selectedProveedor?.id === proveedor.id}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h3 className="font-semibold text-lg mb-4">
                  🚛 Vehículos {selectedProveedor && `- ${selectedProveedor.nombre}`}
                </h3>
                {loading ? <LoadingSpinner /> : (
                  <VehiculosList 
                    vehiculos={vehiculos} 
                    proveedorFilter={selectedProveedor?.nombre}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {activeView === 'optimization' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h2 className="text-xl font-semibold mb-4">⚡ Optimización de Rutas</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Seleccionar Proveedor:
                  </label>
                  <select 
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={selectedProveedor?.id || ''}
                    onChange={(e) => {
                      const proveedor = proveedores.find(p => p.id === e.target.value);
                      setSelectedProveedor(proveedor);
                    }}
                  >
                    <option value="">Seleccionar proveedor...</option>
                    {proveedores.map(proveedor => (
                      <option key={proveedor.id} value={proveedor.id}>
                        {proveedor.nombre} ({Number(proveedor.total_vehiculos || 0)} vehículos)
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="flex items-end">
                  <button
                    onClick={() => selectedProveedor && optimizarRutas(selectedProveedor.id)}
                    disabled={!selectedProveedor || loading}
                    className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {loading ? '⏳ Optimizando...' : '🚀 Optimizar Rutas'}
                  </button>
                </div>
              </div>
            </div>

            {optimizationResult && <OptimizationResults result={optimizationResult} />}
          </div>
        )}

        {activeView === 'import' && (
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-xl font-semibold mb-4">📁 Importar Datos Excel</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Seleccionar archivo Excel:
                </label>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setUploadFile(e.target.files[0])}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>
              
              <button
                onClick={handleFileUpload}
                disabled={!uploadFile || loading}
                className="bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
              >
                {loading ? '⏳ Importando...' : '📤 Importar Datos'}
              </button>

              {uploadResult && (
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <h4 className="font-medium text-green-800">✅ Importación Completada</h4>
                  <ul className="text-sm text-green-700 mt-2">
                    <li>• Vehículos importados: {Number(uploadResult.vehiculos_importados || 0)}</li>
                    <li>• Tiendas importadas: {Number(uploadResult.tiendas_importadas || 0)}</li>
                    {(uploadResult.errores || []).length > 0 && (
                      <li className="text-red-600">• Errores: {(uploadResult.errores || []).length}</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="text-center text-gray-500 text-sm">
            TMS Optimizador de Rutas v1.0 - Sistema de gestión de flota
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;