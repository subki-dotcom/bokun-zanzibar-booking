import client from "./client";

const data = async (request) => (await request).data.data;

// Auth
export const login = (body) => data(client.post("/auth/login", body));
export const fetchMe = () => data(client.get("/auth/me"));
export const changePassword = (body) => data(client.post("/auth/change-password", body));
export const logoutEverywhere = () => data(client.post("/auth/logout-everywhere", {}));

// Dashboard and bookings. Bookings are created only by customers on the website; staff view, price quote
// requests, reject and share the customer's link.
export const fetchDashboard = () => data(client.get("/dashboard"));
export const fetchBookings = (params) => data(client.get("/bookings", { params }));
export const fetchBooking = (id) => data(client.get(`/bookings/${id}`));
export const quoteBooking = (id, body) => data(client.post(`/bookings/${id}/quote`, body));
export const rejectBooking = (id, reason) => data(client.post(`/bookings/${id}/reject`, { reason }));
export const issueCustomerLink = (id) => data(client.post(`/bookings/${id}/customer-link`, {}));

// Pricing catalogue
export const fetchZones = (params) => data(client.get("/zones", { params }));
export const createZone = (body) => data(client.post("/zones", body));
export const updateZone = (id, body) => data(client.patch(`/zones/${id}`, body));
export const fetchLocations = (params) => data(client.get("/locations", { params }));
export const createLocation = (body) => data(client.post("/locations", body));
export const updateLocation = (id, body) => data(client.patch(`/locations/${id}`, body));
export const fetchRoutes = (params) => data(client.get("/routes", { params }));
export const createRoute = (body) => data(client.post("/routes", body));
export const updateRoute = (id, body) => data(client.patch(`/routes/${id}`, body));
export const fetchRates = (params) => data(client.get("/rates", { params }));
export const createRate = (body) => data(client.post("/rates", body));
export const updateRate = (id, body) => data(client.patch(`/rates/${id}`, body));
export const fetchSettings = () => data(client.get("/settings/pricing"));
export const updateSettings = (body) => data(client.patch("/settings/pricing", body));
export const previewPrice = (body) => data(client.post("/pricing/preview", body));

// Fleet and dispatch
export const fetchDrivers = (params) => data(client.get("/drivers", { params }));
export const createDriver = (body) => data(client.post("/drivers", body));
export const updateDriver = (id, body) => data(client.patch(`/drivers/${id}`, body));
export const fetchDriverHistory = (id) => data(client.get(`/drivers/${id}/history`));
export const fetchVehicles = (params) => data(client.get("/vehicles", { params }));
export const createVehicle = (body) => data(client.post("/vehicles", body));
export const updateVehicle = (id, body) => data(client.patch(`/vehicles/${id}`, body));
export const fetchVehicleHistory = (id) => data(client.get(`/vehicles/${id}/history`));
export const fetchTrips = (params) => data(client.get("/dispatch/trips", { params }));
export const assignTrip = (id, body) => data(client.post(`/dispatch/trips/${id}/assign`, body));
export const unassignTrip = (id, body) => data(client.post(`/dispatch/trips/${id}/unassign`, body));
export const changeTripStatus = (id, body) => data(client.post(`/dispatch/trips/${id}/status`, body));

// Users and audit
export const fetchUsers = () => data(client.get("/users"));
export const createUser = (body) => data(client.post("/users", body));
export const updateUser = (id, body) => data(client.patch(`/users/${id}`, body));
export const resetUserPassword = (id, body) => data(client.post(`/users/${id}/reset-password`, body));
export const fetchAuditLogs = (params) => data(client.get("/audit-logs", { params }));
