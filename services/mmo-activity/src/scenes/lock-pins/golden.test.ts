import { SHAPES_DIR, goldenSuite } from "../../../test/golden.ts";
import family from "./index.ts";

goldenSuite(family);
goldenSuite(family, SHAPES_DIR);
