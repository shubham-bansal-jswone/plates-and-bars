# Multi-stage build from the REPOSITORY ROOT, because the API reads the contract and every content file at build time.
# CONTENT_UPDATED_AT (each bundle's git committer date, from a full-history checkout) is required: the build fails
# without it and never falls back to the build time.
#   docker build -f backend/Dockerfile --build-arg CONTENT_UPDATED_AT="$(backend/scripts/content-updated-at.sh)" -t plateandbar-api .
# backend/Dockerfile.dockerignore limits the context to backend/, packages/api/openapi.yaml and content/*.json.
# eclipse-temurin publishes linux/amd64 and linux/arm64 images, so this builds natively on Apple Silicon.
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src/backend
COPY backend/gradlew backend/settings.gradle backend/build.gradle ./
COPY backend/gradle gradle
RUN ./gradlew --no-daemon dependencies > /dev/null 2>&1 || true
COPY packages/api/openapi.yaml /src/packages/api/openapi.yaml
COPY content/*.json /src/content/
ARG CONTENT_UPDATED_AT
RUN sh /src/backend/scripts/content-updated-at.sh --check "$CONTENT_UPDATED_AT"
COPY backend/src src
RUN ./gradlew --no-daemon bootJar -x test

FROM eclipse-temurin:21-jre
ARG CONTENT_UPDATED_AT
ENV CONTENT_UPDATED_AT=$CONTENT_UPDATED_AT
RUN useradd --system --uid 10001 app
WORKDIR /app
COPY --from=build /src/backend/build/libs/*.jar app.jar
USER app
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
