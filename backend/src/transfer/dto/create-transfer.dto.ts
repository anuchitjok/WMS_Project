import { IsString, IsNotEmpty, IsOptional, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTransferDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  stockItemId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'productLabel is required' })
  productLabel: string;

  @ApiProperty({ minimum: 1 })
  @IsNumber()
  @Min(1, { message: 'quantity must be at least 1' })
  quantity: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'fromLocation is required' })
  fromLocation: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'toLocation is required' })
  toLocation: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}
