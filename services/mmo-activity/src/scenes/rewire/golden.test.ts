import { SHAPES_DIR, goldenSuite } from "../../../test/golden.ts";
import rewire from "./index.ts";

goldenSuite(rewire);
goldenSuite(rewire, SHAPES_DIR);
