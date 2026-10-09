package app.plateandbar.api.auth;

import app.plateandbar.api.common.CorsProperties;
import app.plateandbar.api.common.ErrorResponse;
import app.plateandbar.api.ratelimit.ClientIpResolver;
import app.plateandbar.api.ratelimit.RateLimitFilter;
import app.plateandbar.api.ratelimit.RateLimitProperties;
import app.plateandbar.api.ratelimit.RateLimiter;
import com.fasterxml.jackson.databind.ObjectMapper;
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
@EnableConfigurationProperties(CorsProperties.class)
public class SecurityConfig {

    @Bean
    SecurityFilterChain filterChain(
            HttpSecurity http,
            ObjectMapper mapper,
            JwtService jwtService,
            RateLimiter limiter,
            ClientIpResolver clientIps,
            RateLimitProperties limits,
            UserExistenceCheck users)
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
                .cors(Customizer.withDefaults());
        return http.build();
    }

    /**
     * Only the configured web app origins may call the API from a browser. Auth is a bearer header, not a cookie,
     * so credentials are not allowed. With no origins configured every cross-origin request is refused.
     */
    @Bean
    CorsConfigurationSource corsConfigurationSource(CorsProperties props) {
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOrigins(props.allowedOrigins());
        cors.setAllowedMethods(List.of("GET", "POST", "DELETE"));
        cors.setExposedHeaders(List.of("Retry-After"));
        cors.setAllowedHeaders(List.of("Authorization", "Content-Type", "Accept"));
        cors.setAllowCredentials(false);
        cors.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", cors);
        return source;
    }

    private static void writeUnauthorized(ObjectMapper mapper, jakarta.servlet.http.HttpServletResponse response)
            throws java.io.IOException {
        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        mapper.writeValue(response.getOutputStream(), ErrorResponse.of("unauthorized", "Sign in again."));
    }
}
