import { Hono } from "hono";
import clock from "./clock";

const app = new Hono().route("/", clock);

export default app;
