# NoiROBO Server


REST API for the NoiROBO equipment rental platform.


## Purpose

Handles authentication checks, role based access, equipment, favorites, bookings, Stripe payments and dashboard analytics.


## Live URL

Server: https://noirobo-server.vercel.app/

Client : https://noirobo-client-e4mt.vercel.app/


## Key Features

- JWT verification and role middlewares (verifyToken, verifyRenter, verifyOwner, verifyAdmin)

- Server-side search, filter, sort and pagination

- Booking with availability check

- Stripe checkout and payment records

- Admin and owner analytics


## Packages

express, cors, dotenv, mongodb, jsonwebtoken, stripe