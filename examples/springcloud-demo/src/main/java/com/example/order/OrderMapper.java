package com.example.order;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface OrderMapper {

  @Select("SELECT COUNT(*) FROM orders WHERE user_id = #{userId}")
  int countByUser(@Param("userId") Long userId);

  int deleteExpired();
}
