#!/usr/bin/env node
/**
 * Fixture generator for the init-performance validation harness.
 *
 * Creates a synthetic Spring Cloud-style project (controllers, services,
 * mappers, MyBatis XML, Feign clients, entities, application.yml) under
 * a target directory. The fixture is intentionally non-trivial — ~80
 * Java/XML/YAML files — so init takes a few seconds and timing is
 * meaningful.
 *
 * Usage: node scripts/bench/init-validation/gen-fixture.mjs <target-dir>
 */
import * as fs from 'fs';
import * as path from 'path';

const target = process.argv[2];
if (!target) {
  console.error('usage: node gen-fixture.mjs <target-dir>');
  process.exit(1);
}

const NUM_CONTROLLERS = 20;
const NUM_SERVICES = 20;
const NUM_MAPPERS = 20;
const NUM_FEIGN = 5;
const NUM_ENTITIES = 15;

const BASE_PKG = 'com.example.app';
const ENTITIES = ['User', 'Order', 'Product', 'Category', 'Cart', 'Payment', 'Address', 'Inventory', 'Coupon', 'Review', 'Shipment', 'Refund', 'Wishlist', 'Notification', 'Tag'];
const DOMAINS = ['user', 'order', 'product', 'category', 'cart', 'payment', 'address', 'inventory', 'coupon', 'review', 'shipment', 'refund', 'wishlist', 'notification', 'tag', 'auth', 'search', 'admin', 'report', 'config'];

function write(rel, content) {
  const full = path.join(target, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function pascal(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function entityDecl(name) {
  return `package ${BASE_PKG}.entity;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ${name} {
    private Long id;
    private String name;
    private String code;
    private Integer status;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
`;
}

function controllerDecl(domain, entity) {
  const entityName = entity;
  const controllerName = pascal(domain) + 'Controller';
  const serviceName = pascal(domain) + 'Service';
  return `package ${BASE_PKG}.controller;

import ${BASE_PKG}.entity.${entityName};
import ${BASE_PKG}.service.${serviceName};
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/${domain}")
public class ${controllerName} {

    @Autowired
    private ${serviceName} ${domain}Service;

    @GetMapping("/{id}")
    public ${entityName} getById(@PathVariable Long id) {
        return ${domain}Service.getById(id);
    }

    @GetMapping("/list")
    public List<${entityName}> list() {
        return ${domain}Service.list();
    }

    @PostMapping
    public ${entityName} create(@RequestBody ${entityName} body) {
        return ${domain}Service.create(body);
    }

    @PutMapping("/{id}")
    public ${entityName} update(@PathVariable Long id, @RequestBody ${entityName} body) {
        return ${domain}Service.update(id, body);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id) {
        ${domain}Service.delete(id);
    }
}
`;
}

function serviceDecl(domain, entity) {
  const entityName = entity;
  const serviceName = pascal(domain) + 'Service';
  const mapperName = pascal(domain) + 'Mapper';
  return `package ${BASE_PKG}.service;

import ${BASE_PKG}.entity.${entityName};
import ${BASE_PKG}.mapper.${mapperName};
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class ${serviceName} {

    @Autowired
    private ${mapperName} ${domain}Mapper;

    public ${entityName} getById(Long id) {
        return ${domain}Mapper.selectById(id);
    }

    public List<${entityName}> list() {
        return ${domain}Mapper.selectList();
    }

    public ${entityName} create(${entityName} body) {
        ${domain}Mapper.insert(body);
        return body;
    }

    public ${entityName} update(Long id, ${entityName} body) {
        body.setId(id);
        ${domain}Mapper.update(body);
        return body;
    }

    public void delete(Long id) {
        ${domain}Mapper.deleteById(id);
    }
}
`;
}

function mapperDecl(domain, entity) {
  const entityName = entity;
  const mapperName = pascal(domain) + 'Mapper';
  return `package ${BASE_PKG}.mapper;

import ${BASE_PKG}.entity.${entityName};
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.List;

@Mapper
public interface ${mapperName} {
    ${entityName} selectById(@Param("id") Long id);
    List<${entityName}> selectList();
    int insert(${entityName} record);
    int update(${entityName} record);
    int deleteById(@Param("id") Long id);
}
`;
}

function mapperXml(domain, entity) {
  const entityName = entity;
  const tableName = domain;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="${BASE_PKG}.mapper.${pascal(domain)}Mapper">

    <resultMap id="BaseResultMap" type="${BASE_PKG}.entity.${entityName}">
        <id column="id" property="id" jdbcType="BIGINT"/>
        <result column="name" property="name" jdbcType="VARCHAR"/>
        <result column="code" property="code" jdbcType="VARCHAR"/>
        <result column="status" property="status" jdbcType="INTEGER"/>
        <result column="created_at" property="createdAt" jdbcType="TIMESTAMP"/>
        <result column="updated_at" property="updatedAt" jdbcType="TIMESTAMP"/>
    </resultMap>

    <sql id="Base_Column_List">
        id, name, code, status, created_at, updated_at
    </sql>

    <select id="selectById" resultMap="BaseResultMap" parameterType="java.lang.Long">
        SELECT
        <include refid="Base_Column_List"/>
        FROM ${tableName}
        WHERE id = #{id}
    </select>

    <select id="selectList" resultMap="BaseResultMap">
        SELECT
        <include refid="Base_Column_List"/>
        FROM ${tableName}
        ORDER BY id DESC
        LIMIT 1000
    </select>

    <insert id="insert" parameterType="${BASE_PKG}.entity.${entityName}" useGeneratedKeys="true" keyProperty="id">
        INSERT INTO ${tableName} (name, code, status, created_at, updated_at)
        VALUES (#{name}, #{code}, #{status}, NOW(), NOW())
    </insert>

    <update id="update" parameterType="${BASE_PKG}.entity.${entityName}">
        UPDATE ${tableName}
        <set>
            <if test="name != null">name = #{name},</if>
            <if test="code != null">code = #{code},</if>
            <if test="status != null">status = #{status},</if>
            updated_at = NOW()
        </set>
        WHERE id = #{id}
    </update>

    <delete id="deleteById" parameterType="java.lang.Long">
        DELETE FROM ${tableName} WHERE id = #{id}
    </delete>
</mapper>
`;
}

function feignDecl(domain) {
  return `package ${BASE_PKG}.feign;

import ${BASE_PKG}.entity.${pascal(domain)};
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@FeignClient(name = "${domain}-service")
public interface ${pascal(domain)}Client {

    @GetMapping("/api/${domain}/{id}")
    ${pascal(domain)} getById(@PathVariable("id") Long id);

    @GetMapping("/api/${domain}/list")
    List<${pascal(domain)}> list();

    @PostMapping("/api/${domain}")
    ${pascal(domain)} create(@RequestBody ${pascal(domain)} body);
}
`;
}

function applicationYml() {
  return `server:
  port: 8080

spring:
  application:
    name: example-app
  datasource:
    url: jdbc:mysql://localhost:3306/app?useUnicode=true&characterEncoding=utf8
    username: root
    password: \${DB_PASSWORD:secret}
    driver-class-name: com.mysql.cj.jdbc.Driver
  redis:
    host: localhost
    port: 6379
    password: \${REDIS_PASSWORD:secret}
  cloud:
    nacos:
      discovery:
        server-addr: localhost:8848
      config:
        server-addr: localhost:8848

mybatis:
  mapper-locations: classpath:mapper/*.xml
  type-aliases-package: com.example.app.entity

logging:
  level:
    root: INFO
    com.example.app: DEBUG
`;
}

// Generate entities
for (const entity of ENTITIES.slice(0, NUM_ENTITIES)) {
  write(`src/main/java/${BASE_PKG.replace(/\./g, '/')}/entity/${entity}.java`, entityDecl(entity));
}

// Generate controllers + services + mappers + xml per domain
for (let i = 0; i < NUM_CONTROLLERS; i++) {
  const domain = DOMAINS[i % DOMAINS.length];
  const entity = ENTITIES[i % ENTITIES.length];
  write(`src/main/java/${BASE_PKG.replace(/\./g, '/')}/controller/${pascal(domain)}Controller.java`, controllerDecl(domain, entity));
}

for (let i = 0; i < NUM_SERVICES; i++) {
  const domain = DOMAINS[i % DOMAINS.length];
  const entity = ENTITIES[i % ENTITIES.length];
  write(`src/main/java/${BASE_PKG.replace(/\./g, '/')}/service/${pascal(domain)}Service.java`, serviceDecl(domain, entity));
}

for (let i = 0; i < NUM_MAPPERS; i++) {
  const domain = DOMAINS[i % DOMAINS.length];
  const entity = ENTITIES[i % ENTITIES.length];
  write(`src/main/java/${BASE_PKG.replace(/\./g, '/')}/mapper/${pascal(domain)}Mapper.java`, mapperDecl(domain, entity));
  write(`src/main/resources/mapper/${domain}Mapper.xml`, mapperXml(domain, entity));
}

for (let i = 0; i < NUM_FEIGN; i++) {
  const domain = DOMAINS[i % DOMAINS.length];
  write(`src/main/java/${BASE_PKG.replace(/\./g, '/')}/feign/${pascal(domain)}Client.java`, feignDecl(domain));
}

// Config
write('src/main/resources/application.yml', applicationYml());

// A pom.xml so this looks like a real Spring Boot project
write('pom.xml', `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>2.7.0</version>
    </parent>
    <groupId>com.example</groupId>
    <artifactId>app</artifactId>
    <version>1.0.0</version>
    <dependencies>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
        <dependency><groupId>org.springframework.cloud</groupId><artifactId>spring-cloud-starter-openfeign</artifactId></dependency>
        <dependency><groupId>org.mybatis.spring.boot</groupId><artifactId>mybatis-spring-boot-starter</artifactId></dependency>
        <dependency><groupId>org.projectlombok</groupId><artifactId>lombok</artifactId></dependency>
    </dependencies>
</project>
`);

const fileCount = NUM_CONTROLLERS + NUM_SERVICES + NUM_MAPPERS * 2 + NUM_FEIGN + NUM_ENTITIES + 2;
console.log(`fixture generated: ${fileCount} files at ${target}`);
