require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./app.module');
const { HttpExceptionFilter } = require('./common/filters/http-exception.filter');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(3000);
  console.log('Application running on http://localhost:3000');
}

bootstrap();
