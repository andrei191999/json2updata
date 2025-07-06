import axios from "axios";
// import type { AxiosInstance } from "axios";
export const api = axios.create({ baseURL: "/api" });
// export const api: AxiosInstance = axios.create({ baseURL: "/api" });
