# Multi-stage build from the REPOSITORY ROOT, because the API reads the contract and two content files at build time:
#   docker build -f backend/Dockerfile -t plateandbar-api .
# backend/Dockerfile.dockerignore limits the context to backend/ and packages/api/openapi.yaml,
# content/cards.json and content/exercises.json.
# eclipse-temurin publishes linux/amd64 and linux/arm64 images, so this builds natively on Apple Silicon.
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src/backend
COPY backend/gradlew backend/settings.gradle backend/build.gradle ./
COPY backend/gradle gradle
RUN ./gradlew --no-daemon dependencies > /dev/null 2>&1 || true
COPY packages/api/openapi.yaml /src/packages/api/openapi.yaml
COPY content/cards.json content/exercises.json /src/content/
COPY backend/src src
RUN ./gradlew --no-daemon bootJar -x test

FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 app
WORKDIR /app
COPY --from=build /src/backend/build/libs/*.jar app.jar
USER app
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
