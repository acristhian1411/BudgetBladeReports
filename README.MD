# BudgetBlade Reports 📊

Panel web de análisis y reportes para [BudgetBlade](https://github.com/acristhian1411/BudgetBlade), la app móvil de gestión financiera personal. Permite importar los backups cifrados generados por la app e inspeccionar toda la información desde un navegador con gráficos, proyecciones y tablas detalladas.

## Relación con BudgetBlade Mobile

Esta aplicación web es el complemento de escritorio de [BudgetBlade](https://github.com/acristhian1411/BudgetBlade). El flujo de uso típico es:

1. Registrar transacciones y compromisos en la app móvil.
2. Exportar un backup cifrado (`.nbb`) desde la app.
3. Importarlo en este panel para visualizar reportes avanzados.

## ✨ Características

### 📥 Importación de Backups

- **Formato `.nbb`**: Descifra y carga el backup propietario (AES-256-GCM + PBKDF2-SHA256) generado por la app móvil.
- **Validación con Zod**: Verifica la integridad del esquema antes de persistir los datos.
- **Restauración atómica**: Usa transacciones SQL para garantizar consistencia referencial.

### 📊 Dashboard

- **Balance total**: Suma de ingresos menos egresos en todas las cajas.
- **Saldo por caja**: Balance individual de cada cuenta con indicador banco / efectivo.
- **Top categorías de gasto**: Barras proporcionales con los 8 rubros de mayor egreso.
- **Próximos pagos**: Compromisos pendientes o vencidos más cercanos.
- **Transacciones recientes**: Últimas 10 operaciones con categoría, caja, monto y fecha.

### 📅 Proyecciones

- **Línea de tiempo de compromisos**: Todos los vencimientos programados ordenados por fecha.
- **Previsión de liquidez a 180 días**: Proyección diaria del flujo de caja futuro basada en los planes recurrentes.

### 🏢 Entidades

- Visualización de clientes y proveedores vinculados a planes y transacciones.

### 🔐 Autenticación

- Login mediante OAuth2 delegado a un servidor Laravel externo.
- Sesión protegida con middleware en todas las rutas de la API.

## 🚀 Cómo Empezar

### Requisitos

- Docker y Docker Compose
- Una instancia del servidor de autenticación Laravel (configurable)

### Desarrollo

1. Copia el archivo de entorno y configura las variables:

   ```bash
   cp .env.example .env
   ```

2. Levanta el stack completo:

   ```bash
   docker compose up --build
   ```

3. Accede a la aplicación:
   - **Frontend**: http://localhost:5173
   - **API Backend**: http://localhost:3000/api
   - **Base de datos**: localhost:5432

### Producción

```bash
docker build -t your-registry/budgetblade-backend:latest ./backend
docker build -t your-registry/budgetblade-frontend:latest ./frontend
docker push your-registry/budgetblade-backend:latest
docker push your-registry/budgetblade-frontend:latest
```

## 📦 Stack Tecnológico

### Frontend

- **SvelteKit**: Framework web con SSR y routing basado en archivos
- **Tailwind CSS**: Styling utility-first
- **Vite**: Bundler y servidor de desarrollo

### Backend

- **Express.js**: API REST
- **PostgreSQL**: Base de datos relacional
- **node-postgres (pg)**: Cliente de base de datos
- **Zod**: Validación de esquemas

### Seguridad

- **AES-256-GCM**: Descifrado de backups `.nbb`
- **PBKDF2-SHA256**: Derivación de clave maestra
- **OAuth2 (Laravel)**: Autenticación de usuarios

## 🗄️ Estructura de Datos

Las tablas replican el esquema de la app móvil:

| Tabla                   | Descripción                                    |
| ----------------------- | ---------------------------------------------- |
| `users`                 | Credenciales de usuario                        |
| `tills`                 | Cuentas / cajas (banco o efectivo)             |
| `transactions`          | Todas las operaciones registradas              |
| `categories`            | Rubros de ingresos y egresos                   |
| `entities`              | Clientes y proveedores                         |
| `scheduled_plans`       | Planes de pago recurrentes                     |
| `scheduled_occurrences` | Cuotas individuales con estado de cumplimiento |

## 🛡️ Notas de Seguridad

- La clave de descifrado del backup nunca se persiste; se usa en memoria únicamente durante la importación.
- Todas las rutas de la API requieren autenticación OAuth2 válida.
- Las consultas a la base de datos usan parámetros preparados para prevenir inyección SQL.

## 📱 App Móvil

El origen de los datos de este panel es la aplicación móvil **BudgetBlade**:

- Repositorio: [https://github.com/acristhian1411/BudgetBlade](https://github.com/acristhian1411/BudgetBlade)
- Plataformas: iOS y Android (Expo / React Native)
- Exporta backups cifrados `.nbb` compatibles con este panel
