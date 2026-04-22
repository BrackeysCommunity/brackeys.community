data "external_schema" "drizzle" {
  program = [
    "bunx",
    "drizzle-kit",
    "export",
  ]
}

env "local" {
  dev = getenv("ATLAS_DEV_URL")
  schemas = ["public", "auth", "user", "hammer", "collab", "itch"]
  schema {
    src = data.external_schema.drizzle.url
  }
  migration {
    dir = "file://drizzle"
  }
}

env {
  name = atlas.env
  url  = getenv("DATABASE_URL")
  migration {
    dir = "atlas://brackeys"
  }
}
