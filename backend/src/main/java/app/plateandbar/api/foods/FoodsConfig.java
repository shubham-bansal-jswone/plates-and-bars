package app.plateandbar.api.foods;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(OffProperties.class)
public class FoodsConfig {}
