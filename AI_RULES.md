# AI Development Rules for Astra Campaign

This document outlines the rules and conventions for AI-driven development on this project. Following these guidelines ensures consistency, maintainability, and adherence to the project's architecture.

## Tech Stack Overview

This is a full-stack TypeScript application with a React frontend and a Node.js backend, designed for a multi-tenant SaaS environment.

*   **Frontend:** A modern single-page application built with React 18, TypeScript, and Vite.
*   **Backend:** A robust API server built with Node.js (v20), Express, and TypeScript.
*   **Database:** PostgreSQL is the primary relational database, with Prisma as the type-safe ORM. Redis is used for caching and job queues.
*   **Styling:** Tailwind CSS is the exclusive utility-first framework for all styling.
*   **UI Components:** The application uses a combination of custom components and the **shadcn/ui** library, all styled with Tailwind CSS.
*   **Routing:** Client-side routing is handled by React Router Dom.
*   **Forms:** All forms are managed using React Hook Form, with Zod for schema definition and validation.
*   **Real-time Communication:** Socket.io enables real-time, bidirectional communication between the client and server.
*   **Authentication:** The API is secured using JSON Web Tokens (JWT).
*   **Deployment:** The entire application is containerized using Docker and orchestrated with Docker Swarm for production environments.

## Library and Architecture Rules

These are strict rules on which libraries to use for specific tasks. Do not introduce new libraries for tasks that can be accomplished with the existing stack.

### Frontend

*   **UI Components:**
    *   **ALWAYS** prefer using components from the **shadcn/ui** library. All components are pre-installed and available for import.
    *   If a suitable shadcn/ui component does not exist, create a new, small, reusable component in `src/components/`.
    *   Components must be functional components using React Hooks.

*   **Styling:**
    *   **ONLY** use **Tailwind CSS** for all styling.
    *   Do not write custom CSS files (`.css`, `.scss`).
    *   Do not use inline `style` attributes unless for dynamic properties that cannot be handled by Tailwind classes (e.g., calculated transforms).

*   **State Management:**
    *   For local component state, use `useState` and `useReducer`.
    *   For global state that needs to be shared across the application, use the existing React Context providers (e.g., `AuthContext`, `TenantContext`).
    *   **DO NOT** add external state management libraries like Redux, Zustand, or MobX.

*   **Data Fetching:**
    *   All backend API calls **MUST** go through the singleton `apiService` located at `frontend/src/services/api.ts`.
    *   Do not use `axios` or other fetching libraries. The `apiService` is a wrapper around the native `fetch` API.

*   **Forms:**
    *   All forms **MUST** use **React Hook Form** (`useForm`).
    *   All form validation **MUST** use **Zod** and the `@hookform/resolvers/zod` package.

*   **Notifications:**
    *   Use **`react-hot-toast`** for all user-facing notifications (success, error, info).
    *   **DO NOT** use the native `alert()` function.

*   **Icons:**
    *   Use icons from the **`lucide-react`** package, which is pre-installed.

*   **Routing:**
    *   Use **`React Router Dom`** for all client-side routing.
    *   Routes are defined in `frontend/src/App.tsx`. Keep them centralized there.

### Backend

*   **Web Framework:** Use **Express** for creating API routes and middleware.
*   **Database Access:** **ALL** database operations **MUST** go through the **Prisma ORM**. Do not write raw SQL queries. The schema is defined in `backend/prisma/schema.prisma`.
*   **Authentication:** Use **`jsonwebtoken`** for creating and verifying JWTs. Password hashing is done with `bcryptjs`.
*   **Scheduling:** Use **`node-cron`** for any scheduled or recurring tasks.
*   **Real-time:** Use **Socket.io** for any real-time client-server communication, managed through `websocketService.ts`.
*   **File Uploads:** Use **`multer`** for handling file uploads.

### General

*   **Code Style:** The project uses ESLint and Prettier. Ensure all code is linted and formatted correctly.
*   **File Structure:**
    *   Frontend pages go in `frontend/src/pages`.
    *   Reusable frontend components go in `frontend/src/components`.
    *   Backend controllers, services, and routes are in `backend/src/controllers`, `backend/src/services`, and `backend/src/routes` respectively.
*   **Dependencies:** Do not add new dependencies without a strong justification. Always check if the existing stack can solve the problem first.