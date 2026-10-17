package app.plateandbar.api.auth;

import app.plateandbar.api.common.CorsProperties;
import app.plateandbar.api.common.ErrorResponse;
import app.plateandbar.api.ratelimit.ClientIpResolver;
import app.plateandbar.api.ratelimit.RateLimitFilter;
import app.plateandbar.api.ratelimit.RateLimitProperties;
import app.plateandbar.api.ratelimit.RateLimiter;
import tools.jackson.databind.ObjectMapper;
import java.util.List;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;

/**
 * Everything under /api/v1 needs a valid access JWT except /api/v1/health and /api/v1/auth/*
 * (see {@link JwtAuthFilter}). Failures use the contract's Error shape.
 */
@Configuration
@EnableConfigurationProperties({CorsProperties.class, CookieModeProperties.class})
public class SecurityConfig {

    @Bean
    SecurityFilterChain filterChain(
            HttpSecurity http,
            ObjectMapper mapper,
            JwtService jwtService,
            RateLimiter limiter,
            ClientIpResolver clientIps,
            RateLimitProperties limits,
            UserExistenceCheck users,
            CookieModeProperties cookieMode)
            throws Exception {
        AuthenticationEntryPoint unauthorized = (request, response, ex) -> writeUnauthorized(mapper, response);
        AccessDeniedHandler denied = (request, response, ex) -> writeUnauthorized(mapper, response);
        RateLimitFilter rateLimitFilter = new RateLimitFilter(limiter, clientIps, limits, mapper);
        // A rejected bearer token is answered before the rate-limit filter runs, so it is counted here.
        JwtAuthFilter jwtFilter = new JwtAuthFilter(jwtService, mapper, rateLimitFilter::limitByIp, users);
        http.csrf(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(a -> a
                        .requestMatchers("/api/v1/health", "/api/v1/auth/**", "/api/v1/content/**").permitAll()
                        .anyRequest().authenticated())
                .exceptionHandling(e -> e.authenticationEntryPoint(unauthorized).accessDeniedHandler(denied))
                .addFilterBefore(jwtFilter, AnonymousAuthenticationFilter.class)
                .addFilterAfter(rateLimitFilter, JwtAuthFilter.class)
                // Cookie mode's Origin check: after the rate limit (429 before 403), before the body is read (403 before 400).
                .addFilterAfter(new CookieModeOriginFilter(cookieMode, mapper), RateLimitFilter.class)
                .cors(Customizer.withDefaults());
        return http.build();
    }

    /**
     * Exact origins only, never {@code *}. Auth is a bearer header, so no response allows credentials, with one exception
     * (ADR 006): on {@code /api/v1/auth/**} an origin listed in {@code app.auth.cookie-origins} gets
     * {@code Access-Control-Allow-Credentials: true} and its preflights may name {@code X-Auth-Transport}, so the web
     * app can send and receive the refresh cookie. Cookie-mode origins are also allowed everywhere else, without
     * credentials, because the web app's own origin must reach the bearer endpoints too. With no origins configured
     * every cross-origin request is refused.
     * <p>
     * A cookie-mode request ({@code X-Auth-Transport: cookie}, not a preflight) on {@code /auth/**} from any other
     * origin gets no CORS answer here instead of the filter's plain 403, so it reaches the rate limit and then
     * {@link CookieModeOriginFilter}, which refuses it with 403 {@code forbidden} in the {@code Error} shape. A browser
     * on such an origin never gets that far: its preflight is refused (the header is not allowed there).
     */
    @Bean
    CorsConfigurationSource corsConfigurationSource(CorsProperties props, CookieModeProperties cookieMode) {
        List<String> origins = java.util.stream.Stream.concat(props.allowedOrigins().stream(), cookieMode.cookieOrigins().stream())
                .distinct()
                .toList();
        List<String> headers = List.of("Authorization", "Content-Type", "Accept", "If-None-Match");
        CorsConfiguration bearer = cors(origins, headers, false);
        CorsConfiguration withCookies =
                cors(origins, java.util.stream.Stream.concat(headers.stream(), java.util.stream.Stream.of(CookieMode.HEADER)).toList(), true);
        UrlBasedCorsConfigurationSource everywhere = new UrlBasedCorsConfigurationSource();
        everywhere.registerCorsConfiguration("/api/**", bearer);
        return request -> {
            if (CookieMode.path(request).startsWith(CookieMode.AUTH_PREFIX)) {
                String origin = request.getHeader("Origin");
                if (origin != null && cookieMode.cookieOrigins().contains(origin)) {
                    return withCookies;
                }
                boolean preflight = "OPTIONS".equals(request.getMethod());
                if (!preflight && CookieMode.requested(request)) {
                    return null;
                }
            }
            return everywhere.getCorsConfiguration(request);
        };
    }

    private static CorsConfiguration cors(List<String> origins, List<String> headers, boolean credentials) {
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOrigins(origins);
        cors.setAllowedMethods(List.of("GET", "POST", "DELETE"));
        cors.setExposedHeaders(List.of("Retry-After", "ETag"));
        cors.setAllowedHeaders(headers);
        cors.setAllowCredentials(credentials);
        cors.setMaxAge(3600L);
        return cors;
    }

    private static void writeUnauthorized(ObjectMapper mapper, jakarta.servlet.http.HttpServletResponse response)
            throws java.io.IOException {
        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        mapper.writeValue(response.getOutputStream(), ErrorResponse.of("unauthorized", "Sign in again."));
    }
}
