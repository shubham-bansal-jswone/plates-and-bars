package app.plateandbar.api.support;

import app.plateandbar.api.auth.AuthConfig;
import app.plateandbar.api.auth.JwtService;
import app.plateandbar.api.auth.SecurityConfig;
import app.plateandbar.api.common.ApiExceptionHandler;
import app.plateandbar.api.common.ClockConfig;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.context.annotation.Import;

/** The beans every WebMvc test needs so the real security chain and error mapping run. */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Import({SecurityConfig.class, ApiExceptionHandler.class, AuthConfig.class, ClockConfig.class, JwtService.class})
public @interface WebMvcAuthSlice {}
